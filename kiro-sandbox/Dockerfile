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

COPY app.py .

EXPOSE 8080 9000
CMD ["python3", "app.py"]
