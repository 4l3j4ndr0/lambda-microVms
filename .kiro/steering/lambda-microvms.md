# Lambda MicroVM Development Conventions

## Arquitectura
- Siempre usar `arm64` a menos que una dependencia requiera x86_64
- Base image: `al2023-1` (la más reciente disponible)
- Implementar hooks `/ready` y `/validate` en toda imagen para optimizar snapshots

## Seguridad
- Agregar condition keys `aws:SourceAccount` en trust policies (confused deputy)
- Tokens de auth: usar el TTL mínimo necesario, nunca 60 min por defecto
- Reseed CSPRNGs en el hook `/resume` — los snapshots comparten estado de memoria
- Execution roles con least-privilege, scoped a región y cuenta

## Networking
- Puerto por defecto del proxy: 8080
- Usar VPC egress connectors cuando se necesite restringir tráfico saliente
- Para WebSocket/gRPC usar subprotocolo `lambda-microvms.port.<n>`

## Lifecycle
- Configurar `idlePolicy` siempre: `maxIdleDurationSeconds`, `suspendedDurationSeconds`, `autoResumeEnabled`
- Limpiar image versions que no se usen (`delete-microvm-image-version`) para evitar costos de storage
- Runtime hooks son fast-notification (max 60s) — no usar para init pesado

## Código
- Dockerfile en la raíz del zip
- Hook server en puerto 9000 (convención)
- Logging estructurado JSON con correlation IDs
- Inicializar recursos pesados antes del snapshot (en el boot, no en /run)
