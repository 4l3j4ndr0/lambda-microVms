# Sandbox Proxy — Kiro Day

Proxy Node.js que da acceso web público a los sandboxes de Lambda MicroVMs,
uno por participante, mediante un subdominio aleatorio:

```
https://<label>.sandbox.awslearn.cloud   →   MicroVM del participante (code-server)
```

El proxy enruta por el subdominio, inyecta el token de auth (`X-aws-proxy-auth`)
que **renueva solo en background** antes de que expire, y soporta WebSocket
(necesario para code-server).

## Componentes

```
sandbox-proxy/
├── src/
│   ├── server.js         # proxy HTTP/WS: label del Host → routes.json → inyecta token
│   │                     #   + endpoint POST /__reconcile (limpia rutas huérfanas)
│   ├── tokenManager.js   # genera y renueva CreateMicrovmAuthToken en memoria
│   ├── fleet.js          # ensureSandbox / teardown / reconcileRoutes (estado de la flota)
│   └── routes.js         # carga/recarga en caliente de routes.json
├── provision/
│   └── provision.js      # RunMicrovm → espera RUNNING → routes.json → email SES
├── routes.json           # mapa label → {microvmId, endpoint, email}
├── nginx/sandbox.conf    # bloque aditivo para el nginx del server (variante A)
├── Dockerfile
└── docker-compose.yml
```

## Flujo

```
provision.js (una vez por participante)
   RunMicrovm → endpoint → label aleatorio → escribe routes.json → email con la URL

server.js (siempre corriendo)
   request a <label>.sandbox.awslearn.cloud
     → resuelve label en routes.json
     → ensureToken(microvmId)  (cacheado, renovado ~10min antes de expirar)
     → reverse_proxy a https://<endpoint>:443 con X-aws-proxy-auth + X-aws-proxy-port:8080
```

## Prerrequisitos (cambios en infra — requieren autorización)

1. **DNS wildcard (Route 53, zona awslearn.cloud `Z01085031GCQU273UH150`):**
   ```
   *.sandbox.awslearn.cloud  A  52.201.104.115
   ```

2. **TLS wildcard** `*.sandbox.awslearn.cloud` (certbot con DNS-01 Route 53):
   ```
   certbot certonly --dns-route53 -d '*.sandbox.awslearn.cloud'
   ```
   Lo usa nginx (variante A de `nginx/sandbox.conf`).

3. **Rol IAM `ingenis-server-role`** — policy inline (least-privilege, scoped):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "MicroVMsProxy",
         "Effect": "Allow",
         "Action": [
           "lambda-microvms:CreateMicrovmAuthToken",
           "lambda-microvms:RunMicrovm",
           "lambda-microvms:GetMicrovm",
           "lambda-microvms:TerminateMicrovm"
         ],
         "Resource": "*",
         "Condition": { "StringEquals": { "aws:RequestedRegion": "us-east-1" } }
       },
       {
         "Sid": "SESSend",
         "Effect": "Allow",
         "Action": ["ses:SendEmail"],
         "Resource": "*"
       },
       {
         "Sid": "Route53Certbot",
         "Effect": "Allow",
         "Action": ["route53:ChangeResourceRecordSets", "route53:GetChange", "route53:ListResourceRecordSets"],
         "Resource": [
           "arn:aws:route53:::hostedzone/Z01085031GCQU273UH150",
           "arn:aws:route53:::change/*"
         ]
       }
     ]
   }
   ```

4. **nginx** — agregar `nginx/sandbox.conf` en `/etc/nginx/conf.d/`, `nginx -t`, recargar.
   Aditivo; no toca los sitios existentes (rentix, etc.).

5. **SES** — identidad verificada para `SES_FROM` (ej. `no-reply@awslearn.cloud`).
   Si SES está en sandbox mode, solo envía a destinatarios verificados.

## Desplegar en el EC2 (ingenis-server)

```bash
# en el server, dentro de sandbox-proxy/
docker compose build
docker compose up -d
docker compose logs -f sandbox-proxy
# healthcheck
curl -s http://127.0.0.1:8443/__health
```

El contenedor usa el **rol de la instancia** para credenciales AWS (no montar claves).

## Aprovisionar sandboxes

```bash
# uno
SKIP_EMAIL=1 node provision/provision.js --email ana@acme.com --name "Ana"

# batch
node provision/provision.js --file participantes.json
```

`participantes.json`:
```json
[ { "name": "Ana", "email": "ana@acme.com" } ]
```

Variables útiles: `IMAGE_VERSION`, `SES_FROM`, `ROUTES_FILE`, `SKIP_EMAIL=1` (no enviar email, solo crear + escribir ruta).

## Reconciliación de rutas huérfanas (EventBridge → `/__reconcile`)

`teardown()` limpia `routes.json` cuando **nosotros** terminamos un sandbox. Pero la
plataforma también termina MicroVMs **por su cuenta** al vencer el TTL duro
(`maximumDurationInSeconds`) o la idle policy. En esos casos la entrada queda
**huérfana** en `routes.json` y el proxy devuelve 404/errores al resolver ese label.

Para limpiarlas, el proxy expone `POST /__reconcile`: recorre `routes.json`, consulta
`GetMicrovm` por cada entrada y borra las que estén `TERMINATED`/`TERMINATING` o que ya
no existan. Un **EventBridge Rule** lo dispara cada hora (minuto 2).

### Endpoint

- `POST https://registro.sandbox.awslearn.cloud/__reconcile`
- Auth: header `X-Reconcile-Key` comparado en tiempo constante contra `RECONCILE_KEY`.
- Sin `RECONCILE_KEY` definida, el endpoint responde `403` (deshabilitado por defecto).
- Respuesta: `{ "ok": true, "checked": <n>, "removed": ["label", ...] }`.

### Variable de entorno (en el `.env` del EC2, NO en el repo)

```bash
# genera un secreto fuerte
openssl rand -hex 32
# y ponlo en el .env del proxy
RECONCILE_KEY=<valor>
```

El **mismo** valor queda guardado (cifrado) en la Connection de EventBridge, que lo
inyecta como header en cada disparo.

### Infraestructura (ya creada por CLI en la cuenta 590183999298 / us-east-1)

```bash
REGION=us-east-1
ACCOUNT=590183999298
KEY="$(openssl rand -hex 32)"   # el MISMO que va en RECONCILE_KEY del .env

# 1. Connection: guarda la API key (EventBridge la cifra en Secrets Manager).
CONN_ARN=$(aws events create-connection \
  --region "$REGION" --name kiro-reconcile-conn \
  --authorization-type API_KEY \
  --auth-parameters "ApiKeyAuthParameters={ApiKeyName=X-Reconcile-Key,ApiKeyValue=$KEY}" \
  --query ConnectionArn --output text)

# 2. API destination: endpoint del proxy (POST), rate limit 1 req/s.
DEST_ARN=$(aws events create-api-destination \
  --region "$REGION" --name kiro-reconcile-dest \
  --connection-arn "$CONN_ARN" \
  --invocation-endpoint "https://registro.sandbox.awslearn.cloud/__reconcile" \
  --http-method POST --invocation-rate-limit-per-second 1 \
  --query ApiDestinationArn --output text)

# 3. Rol que EventBridge asume para invocar la API destination.
#    Trust con aws:SourceAccount (anti confused-deputy) + principal events.amazonaws.com.
cat > /tmp/rule-trust.json <<JSON
{ "Version": "2012-10-17", "Statement": [{
  "Effect": "Allow",
  "Principal": { "Service": "events.amazonaws.com" },
  "Action": "sts:AssumeRole",
  "Condition": { "StringEquals": { "aws:SourceAccount": "$ACCOUNT" } }
}]}
JSON
ROLE_ARN=$(aws iam create-role --role-name KiroReconcileSchedulerRole \
  --assume-role-policy-document file:///tmp/rule-trust.json \
  --query Role.Arn --output text)

# Permiso mínimo: solo invocar ESA API destination.
cat > /tmp/rule-perm.json <<JSON
{ "Version": "2012-10-17", "Statement": [{
  "Effect": "Allow", "Action": "events:InvokeApiDestination", "Resource": "$DEST_ARN"
}]}
JSON
aws iam put-role-policy --role-name KiroReconcileSchedulerRole \
  --policy-name invoke-reconcile-dest --policy-document file:///tmp/rule-perm.json

# 4. Rule: cron minuto 2 de cada hora (UTC; "minuto 2 de cada hora" es TZ-agnóstico).
aws events put-rule --region "$REGION" --name kiro-reconcile-hourly \
  --schedule-expression "cron(2 * * * ? *)" --state ENABLED \
  --description "Dispara POST /__reconcile (minuto 2 de cada hora)"

# 5. Target: la API destination + el rol.
aws events put-targets --region "$REGION" --rule kiro-reconcile-hourly \
  --targets "[{\"Id\":\"reconcile-dest\",\"Arn\":\"$DEST_ARN\",\"RoleArn\":\"$ROLE_ARN\",\"Input\":\"{}\"}]"
```

> Nota: se usa **EventBridge Rules** (no Scheduler) porque las API destinations son
> target de Rules, no de Scheduler. El cron de Rules es UTC y de 6 campos; el día de
> semana va como `?` cuando se fija el día del mes (y viceversa).

### Probar a mano

```bash
curl -s -X POST https://registro.sandbox.awslearn.cloud/__reconcile \
  -H "X-Reconcile-Key: $RECONCILE_KEY"
# -> {"ok":true,"checked":3,"removed":["ab12cd3"]}
```

### Teardown de la infra

```bash
aws events remove-targets --rule kiro-reconcile-hourly --ids reconcile-dest
aws events delete-rule --name kiro-reconcile-hourly
aws events delete-api-destination --name kiro-reconcile-dest
aws events delete-connection --name kiro-reconcile-conn
aws iam delete-role-policy --role-name KiroReconcileSchedulerRole --policy-name invoke-reconcile-dest
aws iam delete-role --role-name KiroReconcileSchedulerRole
```

## Seguridad

- El label aleatorio del subdominio actúa como secreto: nadie adivina el sandbox de otro.
- El token tiene `allowedPorts: [8080]` (solo code-server), nunca todos los puertos.
- TTL del token = 60 min (máximo), renovado automáticamente.
- Sin secretos en la imagen ni en routes.json (el password de code-server hoy es fijo en la imagen MicroVM).
- El endpoint `/__reconcile` se protege con `RECONCILE_KEY` (header `X-Reconcile-Key`, comparación en tiempo constante). Sin la variable, queda deshabilitado (403). La key la guarda cifrada la Connection de EventBridge; no se commitea.
```
