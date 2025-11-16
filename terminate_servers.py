#!/usr/bin/env python3
"""
Python script to terminate the Ollama server, Node.js server, and localhost server.
This script kills processes related to Ollama and Node.js servers.
"""

import subprocess
import sys
import os
import platform

def run_command(cmd):
    """Run a command and return the output."""
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        return result.returncode, result.stdout, result.stderr
    except Exception as e:
        return 1, "", str(e)

def terminate_servers():
    """
    Terminate Ollama, Node.js, and localhost servers.
    """
    system = platform.system().lower()

    print("Terminating servers...")

    if system == "windows":
        # Windows commands

        # 1. Kill Node.js server on port 3001
        print("Finding and killing Node.js server on port 3001...")
        returncode, stdout, stderr = run_command('netstat -ano | findstr :3001')
        if returncode == 0 and stdout:
            # Extract PID from the last column
            lines = stdout.strip().split('\n')
            for line in lines:
                parts = line.split()
                if len(parts) >= 5:
                    pid = parts[-1]
                    print(f"Killing process {pid} (Node.js server)")
                    run_command(f'taskkill /F /PID {pid}')

        # 2. Kill Ollama processes
        print("Killing Ollama processes...")
        run_command('taskkill /F /IM ollama.exe /T')

        # 3. Kill any remaining node processes (if needed)
        print("Killing any remaining Node.js processes...")
        run_command('taskkill /F /IM node.exe /T')

    else:
        # Unix-like systems (Linux/Mac)
        print("Finding and killing Node.js server on port 3001...")
        returncode, stdout, stderr = run_command('lsof -ti:3001')
        if returncode == 0 and stdout:
            pids = stdout.strip().split('\n')
            for pid in pids:
                print(f"Killing process {pid} (Node.js server)")
                run_command(f'kill -9 {pid}')

        # Kill Ollama processes
        print("Killing Ollama processes...")
        run_command('pkill -f ollama')

        # Kill Node.js processes
        print("Killing Node.js processes...")
        run_command('pkill -f node')

    print("Servers terminated.")

if __name__ == "__main__":
    terminate_servers()
