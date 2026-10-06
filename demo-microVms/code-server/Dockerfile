FROM public.ecr.aws/lambda/microvms:al2023-minimal

# Base dependencies (curl-minimal already present in base)
RUN dnf install -y \
    python3 python3-pip \
    tar gzip unzip git jq vim tmux \
    bash-completion findutils procps-ng shadow-utils \
    docker containerd \
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

# k9s (arm64)
RUN K9S_VER=$(curl -sL https://api.github.com/repos/derailed/k9s/releases/latest | jq -r .tag_name) \
    && curl -sL "https://github.com/derailed/k9s/releases/download/${K9S_VER}/k9s_Linux_arm64.tar.gz" \
    | tar xz -C /usr/local/bin k9s

# Helm
RUN curl -sL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | VERIFY_CHECKSUM=false bash

# code-server (standalone binary)
RUN curl -fsSL https://code-server.dev/install.sh | sh -s -- --method=standalone --prefix=/usr/local

# floci CLI
RUN curl -fsSL https://floci.io/install.sh | sh

# Python deps for hooks
RUN pip install --no-cache-dir flask==3.0.3

COPY app.py .

EXPOSE 8080 9000
CMD ["python3", "app.py"]
