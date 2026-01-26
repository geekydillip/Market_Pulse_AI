#!/usr/bin/env python3
"""
Initialization script for the RAG service
This script installs dependencies and starts the RAG service
"""

import os
import subprocess
import sys
import time
import requests
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def install_dependencies():
    """Install RAG service dependencies"""
    logger.info("Installing RAG service dependencies...")
    
    try:
        # Install requirements
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", "-r", "requirements.txt"
        ], cwd="rag")
        logger.info("Dependencies installed successfully")
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Failed to install dependencies: {e}")
        return False

def start_rag_service():
    """Start the RAG service"""
    logger.info("Starting RAG service...")
    
    try:
        # Start the service in the background
        process = subprocess.Popen([
            sys.executable, "app.py"
        ], cwd="rag/service", stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        
        logger.info(f"RAG service started with PID {process.pid}")
        return process
    except Exception as e:
        logger.error(f"Failed to start RAG service: {e}")
        return None

def check_service_health(base_url="http://localhost:5000", timeout=30):
    """Check if the RAG service is healthy"""
    logger.info("Checking RAG service health...")
    
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            response = requests.get(f"{base_url}/health", timeout=2)
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "healthy":
                    logger.info("RAG service is healthy")
                    return True
        except requests.RequestException:
            pass
        
        time.sleep(2)
    
    logger.error("RAG service is not responding")
    return False

def main():
    """Main initialization function"""
    logger.info("Initializing RAG service...")
    
    # Change to the rag directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)
    
    # Install dependencies
    if not install_dependencies():
        logger.error("Failed to install dependencies. Exiting.")
        sys.exit(1)
    
    # Start the service
    process = start_rag_service()
    if not process:
        logger.error("Failed to start RAG service. Exiting.")
        sys.exit(1)
    
    # Give the service time to start
    time.sleep(5)
    
    # Check service health
    if not check_service_health():
        logger.error("RAG service failed health check. Exiting.")
        process.terminate()
        sys.exit(1)
    
    logger.info("RAG service initialized successfully!")
    logger.info("Service is running in the background")
    
    # Keep the script alive to maintain the service
    try:
        process.wait()
    except KeyboardInterrupt:
        logger.info("Shutting down RAG service...")
        process.terminate()
        process.wait()
        logger.info("RAG service shut down successfully")

if __name__ == "__main__":
    main()