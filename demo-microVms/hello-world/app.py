from flask import Flask
import threading

app = Flask(__name__)

@app.get("/")
def root():
    return {"hello": "world"}

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
    return "", 200

@hooks.post(f"{P}/resume")
def resume():
    return "", 200

@hooks.post(f"{P}/suspend")
def suspend():
    return "", 200

@hooks.post(f"{P}/terminate")
def terminate():
    return "", 200

if __name__ == "__main__":
    threading.Thread(target=lambda: hooks.run(host="0.0.0.0", port=9000), daemon=True).start()
    app.run(host="0.0.0.0", port=8080)
