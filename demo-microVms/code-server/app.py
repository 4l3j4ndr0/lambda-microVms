from flask import Flask
import subprocess, os, time, threading

PASSWORD = "microvm2026"

# Write bashrc so all terminals get floci env
with open("/root/.bashrc", "w") as f:
    f.write("export AWS_ENDPOINT_URL=http://localhost:4566\n"
            "export AWS_ACCESS_KEY_ID=test\n"
            "export AWS_SECRET_ACCESS_KEY=test\n"
            "export AWS_DEFAULT_REGION=us-east-1\n")

# Start code-server immediately (available at boot)
env = {**os.environ, "HOME": "/root",
       "AWS_ENDPOINT_URL": "http://localhost:4566",
       "AWS_ACCESS_KEY_ID": "test",
       "AWS_SECRET_ACCESS_KEY": "test",
       "AWS_DEFAULT_REGION": "us-east-1",
       "PASSWORD": PASSWORD}
subprocess.Popen(["code-server", "--bind-addr", "0.0.0.0:8080",
                  "--auth", "password", "--disable-telemetry"], env=env)

def start_docker_and_floci():
    """Start containerd -> dockerd -> floci. Called on /run and /resume."""
    subprocess.Popen(["containerd"], stdout=open("/var/log/containerd.log", "w"), stderr=subprocess.STDOUT)
    time.sleep(12)
    subprocess.Popen(["dockerd", "--containerd", "/run/containerd/containerd.sock", "--storage-driver=vfs"],
                     stdout=open("/var/log/dockerd.log", "w"), stderr=subprocess.STDOUT)
    time.sleep(15)
    subprocess.Popen(["floci", "start"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# Lifecycle hooks on port 9000
hooks = Flask("hooks")
P = "/aws/lambda-microvms/runtime/v1"

@hooks.post(f"{P}/ready")
def ready():
    return "", 200

@hooks.post(f"{P}/validate")
def validate():
    return "", 200

@hooks.post(f"{P}/run")
def run():
    # Start Docker + floci after snapshot restore (runtime only)
    threading.Thread(target=start_docker_and_floci, daemon=True).start()
    return "", 200

@hooks.post(f"{P}/resume")
def resume():
    threading.Thread(target=start_docker_and_floci, daemon=True).start()
    return "", 200

@hooks.post(f"{P}/suspend")
def suspend():
    return "", 200

@hooks.post(f"{P}/terminate")
def terminate():
    return "", 200

if __name__ == "__main__":
    hooks.run(host="0.0.0.0", port=9000)
