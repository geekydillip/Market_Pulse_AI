#!/usr/bin/env python3
"""
Startup script for RAG service
This script starts the RAG service and initializes it with data.
"""

import subprocess
import sys
import os
import time
import requests
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def check_rag_service_health(url: str = "http://127.0.0.1:5000/health") -> bool:
    """
    Check if the RAG service is healthy.
    
    Args:
        url: Health check URL
        
    Returns:
        True if service is healthy, False otherwise
    """
    try:
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            health_data = response.json()
            return health_data.get("status") == "healthy"
    except Exception as e:
        logger.debug(f"Health check failed: {e}")
        return False
    return False

def start_rag_service():
    """
    Start the RAG service in the background.
    """
    # Check if service is already running
    if check_rag_service_health():
        logger.info("RAG service is already running")
        return
    
    # Start the RAG service
    logger.info("Starting RAG service...")
    
    # Change to the project root directory
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(project_root)
    
    # Start the Flask server in the background
    try:
        # Use subprocess to start the server
        process = subprocess.Popen([
            sys.executable, "-m", "rag.server"
        ], cwd="./rag", stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        
        logger.info(f"Started RAG service with PID {process.pid}")
        
        # Wait a moment for the service to start
        time.sleep(3)
        
        # Check if service started successfully
        if check_rag_service_health():
            logger.info("RAG service started successfully")
        else:
            logger.warning("RAG service may not have started correctly")
            
    except Exception as e:
        logger.error(f"Failed to start RAG service: {e}")
        raise

def initialize_rag_data():
    """
    Initialize RAG service with data from Excel files.
    """
    logger.info("Initializing RAG service with Excel data...")

    try:
        # Run the initialization script directly
        result = subprocess.run([
            sys.executable, "initialize.py"
        ], cwd="./rag", capture_output=True, text=True)

        if result.returncode == 0:
            logger.info("RAG data initialization completed successfully")
            logger.debug(f"Output: {result.stdout}")
        else:
            logger.error(f"RAG data initialization failed: {result.stderr}")

    except Exception as e:
        logger.error(f"Failed to initialize RAG data: {e}")
        raise

def main():
    """
    Main function to start the RAG service and initialize data.
    """
    logger.info("Starting RAG service setup...")
    
    # Start the RAG service
    start_rag_service()
    
    # Wait a moment for the service to fully start
    time.sleep(2)
    
    # Initialize with data
    initialize_rag_data()
    
    logger.info("RAG service setup completed")

if __name__ == "__main__":
    main()