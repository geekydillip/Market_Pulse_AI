#!/usr/bin/env python3
"""
Python script to run the Ollama Web Processor Node.js server.
This script uses subprocess to execute the npm start command.
It also starts the Ollama server and loads the specified model automatically.
"""

import subprocess
import time
import requests
import os
import signal
import sys
from pathlib import Path

OLLAMA_CMD = "ollama"  # must be on PATH, or use full path like "/usr/local/bin/ollama"
API_BASE = "http://localhost:11434"

def start_ollama_server():
    """
    Start `ollama serve` in a background process. Return Popen object.
    """
    # On Windows you might want creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
    popen = subprocess.Popen([OLLAMA_CMD, "serve"],
                             stdout=None,
                             stderr=None,
                             text=True)
    return popen

def start_model(model_name):
    """
    Option A: start the model via CLI (runs model process)
    """
    # Run without waiting; this will start the model process in foreground for this shell,
    # so keep it as background process by Popen.
    pop = subprocess.Popen([OLLAMA_CMD, "run", model_name],
                           stdout=None,
                           stderr=None,
                           text=True)
    return pop

def wait_for_api(timeout=20):
    """
    Poll the API root until it responds (or timeout).
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = requests.get(API_BASE + "/")  # root or /api/health depending on version
            if r.ok:
                return True
        except requests.RequestException:
            pass
        time.sleep(0.5)
    return False

def load_model_via_api(model_name, timeout=20):
    """
    An alternative to `ollama run` — issue a generate POST with empty prompt to load model.
    Per Ollama docs, sending an empty prompt will load a model into memory.
    """
    url = API_BASE + "/api/generate"
    payload = {"model": model_name}
    headers = {"Content-Type": "application/json"}
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = requests.post(url, json=payload, headers=headers, timeout=5)
            if r.status_code in (200, 201, 204):
                return r.json() if r.text else {}
            # some error codes contain useful messages; raise to surface them
            else:
                return {"error": f"HTTP {r.status_code}: {r.text}"}
        except requests.RequestException as e:
            time.sleep(0.5)
    return {"error": "timeout waiting for /api/generate"}

def run_server():
    """
    Run the Node.js server using npm start.
    """
    try:
        # Change to the current directory (in case run from elsewhere)
        os.chdir(os.path.dirname(os.path.abspath(__file__)))

        # Kill any existing Node.js server on port 3001
        print("Checking for existing Node.js server on port 3001...")
        if os.name == 'nt':  # Windows
            try:
                result = subprocess.run(['netstat', '-ano'], capture_output=True, text=True, shell=True)
                for line in result.stdout.split('\n'):
                    if ':3001' in line and 'LISTENING' in line:
                        parts = line.split()
                        if len(parts) >= 5:
                            pid = parts[-1]
                            print(f"Killing existing process {pid} on port 3001...")
                            subprocess.run(['taskkill', '/F', '/PID', pid], capture_output=True)
            except Exception as e:
                print(f"Warning: Could not check/kill existing server: {e}")

        # Install dependencies
        print("Installing Node.js dependencies...")
        use_shell = os.name == 'nt'  # True on Windows
        subprocess.run(["npm", "install"], check=True, shell=use_shell)

        # Run npm start
        print("Starting Ollama Web Processor server...")
        subprocess.run(["npm", "start"], check=True, shell=use_shell)

    except subprocess.CalledProcessError as e:
        print(f"Error running server: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nServer stopped by user.")
        sys.exit(0)
    except Exception as e:
        print(f"Unexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    model = "gemma3:4b"  # change to your model name
    print("Checking if Ollama server is already running...")
    if not wait_for_api(5):
        print("Ollama server not running. Starting ollama server...")
        server_proc = start_ollama_server()
        if not wait_for_api(30):
            print("Ollama API didn't come up in time. Check logs or PATH.")
            # optional: read server_proc.stderr.readline() to see errors
            raise SystemExit(1)
    else:
        print("Ollama server already running.")
    print("Ollama API reachable.")

    print(f"Loading model {model} via API...")
    result = load_model_via_api(model, timeout=60)
    print("Load result:", result)

    run_server()
