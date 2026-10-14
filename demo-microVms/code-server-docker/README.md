# code-server con tema Dracula + banner de bienvenida

Imagen Docker de [code-server](https://github.com/coder/code-server) que arranca con:

- Tema **Dracula** y **tema de iconos** activados por defecto.
- Un **set de extensiones** instaladas por defecto (declarativo en `extensions.txt`).
- Un **banner de bienvenida personalizado** en la pantalla de login.

## Estructura

```
code-server-docker/
├── Dockerfile            # Imagen: instala extensiones + parchea el login
├── docker-compose.yml    # Orquestacion y persistencia
├── settings.json         # Settings de VS Code (tema + icon theme por defecto)
├── extensions.txt        # Lista de extensiones a instalar (una por linea)
├── welcome/
│   └── welcome.html      # HTML del banner de bienvenida
└── workspace/            # Tus proyectos (montado en el contenedor)
```

## Extensiones y tema por defecto

Las extensiones se definen de forma declarativa en **`extensions.txt`**, una por
linea con el formato `publisher.extension`. Durante el build, el Dockerfile las
instala todas en el `extensions-dir` del usuario `coder`:

```
# Las lineas vacias y las que empiezan con '#' se ignoran
dracula-theme.theme-dracula
pkief.material-icon-theme
# ms-python.python
```

> code-server usa el marketplace **[Open VSX](https://open-vsx.org)**, no el de
> VS Code. Busca ahi el ID correcto de cada extension.

El **tema** y el **icon theme** por defecto se activan en `settings.json`
(`workbench.colorTheme`, `workbench.iconTheme`). El nombre debe coincidir con el
que declara la extension instalada.

Para cambiar extensiones o tema: edita `extensions.txt` / `settings.json` y
reconstruye con `--build`.

## Cómo funciona el banner

code-server sirve su pantalla de login desde
`/usr/lib/code-server/src/browser/pages/login.html`. Durante el **build** (como
root) el Dockerfile:

1. Relaja la CSP del login (`style-src 'self' 'unsafe-inline'`) para permitir
   los estilos inline del banner.
2. Inyecta el contenido de `welcome/welcome.html` justo después de `<body>`.

Para cambiar el mensaje, edita `welcome/welcome.html` y reconstruye la imagen.

## Uso con docker compose (recomendado)

```bash
# Define una contrasena segura (opcional, por defecto "cambia-esta-clave")
export CODE_SERVER_PASSWORD="mi-clave-segura"

# Construir y levantar
docker compose up -d --build

# Abrir en el navegador
open http://localhost:8080
```

Detener:

```bash
docker compose down
```

## Uso con docker run

```bash
# Construir
docker build -t code-server-dracula:latest .

# Levantar
docker run -d --name code-server-dracula \
  -p 8080:8080 \
  -e PASSWORD="mi-clave-segura" \
  -v "$PWD/workspace:/home/coder/project" \
  code-server-dracula:latest

# Abrir
open http://localhost:8080
```

## Personalización

- **Extensiones**: edita `extensions.txt` (una por linea, IDs de Open VSX).
- **Mensaje de bienvenida**: edita `welcome/welcome.html` (usa estilos inline).
- **Tema / icon theme / settings**: edita `settings.json`.
- **Contraseña**: variable de entorno `PASSWORD` (o `CODE_SERVER_PASSWORD` en compose).

Tras editar cualquiera de estos archivos, reconstruye con `--build`.

## Nota sobre persistencia

El compose monta un volumen solo en `/home/coder/.config` (config de
code-server), **no** en `/home/coder/.local`, para no sobrescribir el tema
Dracula ni los settings que vienen horneados en la imagen.
