# lambda-microVms — Kiro Day Medellín 2026

Ambientes **sandbox por participante** para el workshop del Kiro Day (24 oct 2026),
construidos sobre **AWS Lambda MicroVMs**: cada participante recibe un VS Code en el
navegador (code-server) con **Kiro CLI** preinstalado, aislado y efímero.

## Estructura

```
.
├── kiro-sandbox/        # Imagen MicroVM: code-server + Kiro CLI (Dockerfile + app.py)
├── sandbox-proxy/       # Proxy Node.js: enruta por subdominio, inyecta/renueva token, WS
├── demo-microVms/       # Demos previas (hello-world, code-server)
└── .kiro/
    ├── skills/          # microvm-deploy (empaqueta + sube artefacto a S3)
    ├── steering/        # convenciones del proyecto
    └── agents/
```

## Arquitectura

```
Email → https://<label>.sandbox.awslearn.cloud
            │  (DNS wildcard A → IP del EC2)
            ▼
      EC2 (nginx + sandbox-proxy en Docker)
            │  label → routes.json → {microvmId, endpoint}
            │  inyecta X-aws-proxy-auth (token renovado) + X-aws-proxy-port:8080
            ▼
      Lambda MicroVM (code-server :8080 + Kiro CLI)
```

## Componentes

- **kiro-sandbox/** — imagen MicroVM. Ver `kiro-sandbox/README.md`.
- **sandbox-proxy/** — proxy + aprovisionador. Ver `sandbox-proxy/README.md`.
- **.kiro/skills/microvm-deploy/** — empaqueta y sube la imagen versionada al bucket S3.

## Despliegue (resumen)

1. Construir la imagen `kiro-sandbox` (skill `microvm-deploy` → S3 → `create-microvm-image`).
2. Desplegar `sandbox-proxy` en el EC2 (Docker + nginx + TLS wildcard).
3. `provision.js` crea una MicroVM por participante y manda el email con su URL.

Detalles en los README de cada carpeta.
