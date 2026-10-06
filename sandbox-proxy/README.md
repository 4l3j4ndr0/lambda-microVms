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
│   ├── tokenManager.js   # genera y renueva CreateMicrovmAuthToken en memoria
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

## Seguridad

- El label aleatorio del subdominio actúa como secreto: nadie adivina el sandbox de otro.
- El token tiene `allowedPorts: [8080]` (solo code-server), nunca todos los puertos.
- TTL del token = 60 min (máximo), renovado automáticamente.
- Sin secretos en la imagen ni en routes.json (el password de code-server hoy es fijo en la imagen MicroVM).
```
