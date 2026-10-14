# mcp-lambda-microvms

Servidor **MCP local (stdio)** para operar **AWS Lambda MicroVMs**. Dos capas:

- **Genérica** (reusable para cualquier proyecto de microVMs): mapea la API de
  `lambda-microvms` — instancias e imágenes.
- **Kiro Day** (específica del evento): opera el estado del evento (`config.json`,
  `routes.json`) que vive en el EC2, vía **SSM**.

## Seguridad

- Corre **local por stdio**: no escucha en ningún puerto, no hay API key, no hay
  superficie pública. La única barrera es tu propia máquina.
- Usa **tu identidad AWS** (la cadena estándar del SDK: `AWS_PROFILE`, env, rol).
  Los permisos del MCP son los tuyos.
- Las acciones **destructivas** (`terminate_microvm`, `delete_microvm_image_version`,
  `kiroday_teardown_sandbox`) solo se registran con `MCP_ALLOW_DESTRUCTIVE=1`.

## Tools

### Genéricas — instancias
`list_microvms`, `get_microvm`, `run_microvm`, `suspend_microvm`, `resume_microvm`,
`create_microvm_auth_token`, `terminate_microvm` (destructiva).

### Genéricas — imágenes
`list_microvm_images`, `get_microvm_image`, `list_microvm_image_versions`,
`get_microvm_image_version`, `list_microvm_image_builds`,
`list_managed_microvm_images`, `list_managed_microvm_image_versions`,
`create_microvm_image`, `update_microvm_image`,
`delete_microvm_image_version` (destructiva).

### Kiro Day (vía SSM)
`kiroday_get_config`, `kiroday_set_max_sandboxes`,
`kiroday_set_registration_enabled`, `kiroday_set_image_version`,
`kiroday_list_sandboxes`, `kiroday_teardown_sandbox` (destructiva).

## Variables de entorno

| Var | Default | Para qué |
|-----|---------|----------|
| `AWS_PROFILE` | — | Perfil AWS (ej. `sso-personal`). |
| `AWS_REGION` | `us-east-1` | Región. |
| `MCP_ALLOW_DESTRUCTIVE` | `0` | `1` habilita las tools destructivas. |
| `KIRODAY_ENABLED` | `1` | `0` desactiva las tools del evento (deja solo las genéricas). |
| `KIRODAY_INSTANCE_ID` | `i-02df93e0743fa1e9a` | EC2 del proxy (para SSM). |
| `KIRODAY_APP_DIR` | `/root/sandbox-proxy/source/sandbox-proxy` | Dir del proxy en el EC2. |
| `KIRODAY_BASE_DOMAIN` | `sandbox.awslearn.cloud` | Dominio base para construir URLs. |

## Instalar

```bash
npm install
```

## Registrar en Kiro

En la config de MCP de Kiro (`~/.kiro/settings/mcp.json` o workspace):

```json
{
  "mcpServers": {
    "lambda-microvms": {
      "command": "node",
      "args": ["/Users/usuario/Documents/kiro-day-medellin-2026/mcp-lambda-microvms/src/index.js"],
      "env": {
        "AWS_PROFILE": "sso-personal",
        "AWS_REGION": "us-east-1",
        "MCP_ALLOW_DESTRUCTIVE": "0"
      }
    }
  }
}
```

Para habilitar operaciones destructivas (teardown, terminate), poné
`MCP_ALLOW_DESTRUCTIVE` en `"1"`.
