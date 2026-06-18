import os
import sys
import subprocess

# Vercel이 이 app 변수를 찾아 실행하게 됩니다.
def app(environ, start_response):
    # 내부적으로 streamlit을 headless 모드로 강제 실행합니다.
    cmd = [
        sys.executable,
        "-m",
        "streamlit",
        "run",
        "main.py", # 실제 스트림릿 코드는 main.py로 이동
        "--server.port", "8080",
        "--server.address", "0.0.0.0",
        "--server.headless", "true"
    ]
    
    # 프로세스를 백그라운드가 아닌 형태로 실행하여 Vercel 포트와 바인딩
    process = subprocess.Popen(cmd)
    
    status = '200 OK'
    response_headers = [('Content-type', 'text/plain')]
    start_response(status, response_headers)
    return [b"Streamlit Server Started! Please check your Vercel URL."]
