FROM codercom/code-server:latest

# Ejecutamos como root para instalar extensiones, copiar config y parchear el login
USER root

# ---------------------------------------------------------------------------
# Ruta de la plantilla de login de code-server (verificada en la imagen oficial)
# ---------------------------------------------------------------------------
ENV LOGIN_HTML=/usr/lib/code-server/src/browser/pages/login.html

# ---------------------------------------------------------------------------
# Instalacion de extensiones por defecto en la carpeta del usuario coder
#   (si se instala como root va a /root/.local y el runtime no la encuentra).
# La lista se define de forma declarativa en extensions.txt (una por linea).
# Para agregar/quitar extensiones: edita extensions.txt y reconstruye.
# ---------------------------------------------------------------------------
ENV EXT_DIR=/home/coder/.local/share/code-server/extensions
COPY extensions.txt /tmp/extensions.txt
RUN set -eux; \
    mkdir -p "$EXT_DIR"; \
    grep -vE '^\s*(#|$)' /tmp/extensions.txt | while read -r ext; do \
      echo "Instalando extension: $ext"; \
      code-server --extensions-dir "$EXT_DIR" --install-extension "$ext"; \
    done; \
    rm -f /tmp/extensions.txt

# ---------------------------------------------------------------------------
# Settings de VS Code: activa el tema Dracula por defecto
# ---------------------------------------------------------------------------
RUN mkdir -p /home/coder/.local/share/code-server/User
COPY settings.json /home/coder/.local/share/code-server/User/settings.json

# ---------------------------------------------------------------------------
# Mensaje de bienvenida custom en el login (parcheo en build-time, como root)
#   1) Relaja la CSP del login para permitir estilos inline del banner.
#   2) Inyecta el banner justo despues de <body>.
# ---------------------------------------------------------------------------
COPY welcome/welcome.html /tmp/welcome.html
RUN set -eux; \
    perl -0pi -e "s/style-src 'self'/style-src 'self' 'unsafe-inline'/g" "$LOGIN_HTML"; \
    WELCOME_CONTENT="$(cat /tmp/welcome.html)" perl -0pi -e 's/(<body[^>]*>)/$1 . $ENV{WELCOME_CONTENT}/e' "$LOGIN_HTML"; \
    grep -q "custom-welcome-banner" "$LOGIN_HTML"; \
    rm -f /tmp/welcome.html

# ---------------------------------------------------------------------------
# Workspace inicial "kiro-day": carpeta de trabajo por defecto del participante.
# Se hornea en la imagen; code-server la abre al arrancar (ver ENTRYPOINT).
# ---------------------------------------------------------------------------
RUN mkdir -p /home/coder/project
COPY workspace/kiro-day /home/coder/project/kiro-day

# ---------------------------------------------------------------------------
# Terminal de bienvenida: script horneado + enganche en .bashrc.
# El task .vscode/tasks.json del workspace abre una terminal al cargar la
# carpeta (runOn: folderOpen) y este script imprime el banner de bienvenida.
# El guard [[ $- == *i* ]] asegura que solo corre en shells interactivos.
# ---------------------------------------------------------------------------
COPY welcome/welcome-terminal.sh /home/coder/.welcome-terminal.sh
RUN chmod +x /home/coder/.welcome-terminal.sh && \
    printf '\n# Mensaje de bienvenida Kiro Day\nif [[ $- == *i* ]] && [ -f ~/.welcome-terminal.sh ]; then\n  . ~/.welcome-terminal.sh\nfi\n' >> /home/coder/.bashrc

# Permisos para el usuario coder sobre su config/datos/extensiones/workspace
RUN chown -R coder:coder /home/coder/.local /home/coder/.config /home/coder/project /home/coder/.welcome-terminal.sh /home/coder/.bashrc 2>/dev/null || true

USER coder

EXPOSE 8080

# Fijamos el bind-addr y abrimos el workspace kiro-day por defecto
ENTRYPOINT ["/usr/bin/entrypoint.sh", "--bind-addr", "0.0.0.0:8080", "/home/coder/project/kiro-day"]
