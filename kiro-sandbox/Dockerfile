FROM public.ecr.aws/lambda/microvms:al2023-minimal

# Base dependencies (curl-minimal already present in base)
RUN dnf install -y \
    python3 python3-pip \
    tar gzip unzip git jq vim tmux \
    bash-completion findutils procps-ng shadow-utils \
    && dnf clean all

# Node.js 22 (required by code-server)
RUN curl -sL https://rpm.nodesource.com/setup_22.x | bash - \
    && dnf install -y nodejs && dnf clean all

# AWS CLI v2 (arm64)
RUN curl -sL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o /tmp/awscli.zip \
    && unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install && rm -rf /tmp/aws /tmp/awscli.zip

# kubectl (arm64)
RUN KUBECTL_VER=$(curl -sL https://dl.k8s.io/release/stable.txt) \
    && curl -sLO "https://dl.k8s.io/release/${KUBECTL_VER}/bin/linux/arm64/kubectl" \
    && install kubectl /usr/local/bin/kubectl && rm kubectl

# Helm
RUN curl -sL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | VERIFY_CHECKSUM=false bash

# code-server (standalone binary)
RUN curl -fsSL https://code-server.dev/install.sh | sh -s -- --method=standalone --prefix=/usr/local

# Kiro CLI (arm64 ZIP installer, non-interactive)
# Uses the MUSL build: the GNU build requires glibc >= 2.39, but the al2023 base
# ships glibc 2.34. The musl package is statically linked with no external libc
# dependency, so it runs on al2023.
# --no-confirm skips the shell-config prompt; --force is required because the
# image build runs as root and the installer refuses root installs otherwise.
# We symlink into /usr/local/bin so every terminal and code-server integrated
# terminal picks it up on PATH.
RUN curl --proto '=https' --tlsv1.2 -sSf \
      'https://desktop-release.q.us-east-1.amazonaws.com/latest/kirocli-aarch64-linux-musl.zip' \
      -o /tmp/kirocli.zip \
    && unzip -q /tmp/kirocli.zip -d /tmp \
    && HOME=/root bash /tmp/kirocli/install.sh --no-confirm --force \
    && rm -rf /tmp/kirocli /tmp/kirocli.zip \
    && KIRO_BIN="$(command -v kiro-cli || find /root /usr/local -name kiro-cli -type f 2>/dev/null | head -1)" \
    && ln -sf "$KIRO_BIN" /usr/local/bin/kiro-cli \
    && /usr/local/bin/kiro-cli --version

# Python deps for hooks
RUN pip install --no-cache-dir flask==3.0.3

# ---------------------------------------------------------------------------
# Login personalizado de code-server (parcheo en build-time)
#   1) Localiza la plantilla login.html del binario standalone.
#   2) Relaja la CSP: permite estilos inline (banner) e imagenes externas (logo
#      de Kiro servido por jsdelivr).
#   3) Inyecta el banner de bienvenida justo despues de <body>.
# Se usa Python (perl no viene en al2023-minimal); python3 ya esta instalado.
# ---------------------------------------------------------------------------
COPY welcome/welcome.html /tmp/welcome.html
RUN python3 - <<'PYEOF'
import glob, sys
matches = glob.glob("/usr/local/lib/**/browser/pages/login.html", recursive=True)
assert matches, "login.html de code-server no encontrado"
path = matches[0]
print("Patching:", path)
with open(path, encoding="utf-8") as f:
    html = f.read()
with open("/tmp/welcome.html", encoding="utf-8") as f:
    banner = f.read()

# 1) CSP: estilos inline + imagen externa del logo (jsdelivr)
html = html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
html = html.replace("img-src 'self' data:", "img-src 'self' data: https://cdn.jsdelivr.net")

# 2) Inyectar el banner tras la primera etiqueta <body...>
import re
new_html, n = re.subn(r"(<body[^>]*>)", lambda m: m.group(1) + banner, html, count=1)
assert n == 1, "no se encontro <body> para inyectar el banner"
assert "custom-welcome-banner" in new_html

with open(path, "w", encoding="utf-8") as f:
    f.write(new_html)
print("OK: banner inyectado y CSP relajada")
PYEOF
RUN rm -f /tmp/welcome.html

COPY app.py .

# ---------------------------------------------------------------------------
# Extensiones por defecto (declarativo en extensions.txt), settings (tema +
# icon theme), workspace inicial "kiro-day" y script de terminal de bienvenida.
# Todo horneado en el user-data-dir de root (donde code-server standalone busca).
# ---------------------------------------------------------------------------
ENV EXT_DIR=/root/.local/share/code-server/extensions
ENV USER_DIR=/root/.local/share/code-server/User
COPY extensions.txt /tmp/extensions.txt
RUN set -eux; \
    mkdir -p "$EXT_DIR" "$USER_DIR"; \
    grep -vE '^\s*(#|$)' /tmp/extensions.txt | while read -r ext; do \
      echo "Instalando extension: $ext"; \
      code-server --extensions-dir "$EXT_DIR" --install-extension "$ext"; \
    done; \
    rm -f /tmp/extensions.txt

COPY settings.json /root/.local/share/code-server/User/settings.json

# Workspace inicial "kiro-day" (code-server lo abre al arrancar; ver app.py)
RUN mkdir -p /root/project
COPY workspace/kiro-day /root/project/kiro-day

# Script de terminal de bienvenida (lo invoca .bashrc, que escribe app.py)
COPY welcome/welcome-terminal.sh /root/.welcome-terminal.sh
RUN chmod +x /root/.welcome-terminal.sh

EXPOSE 8080 9000
CMD ["python3", "app.py"]
