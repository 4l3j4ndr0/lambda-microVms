FROM public.ecr.aws/lambda/microvms:al2023-minimal
RUN dnf install -y python3 python3-pip && dnf clean all
RUN pip install --no-cache-dir flask==3.0.3
COPY app.py .
EXPOSE 8080 9000
CMD ["python3", "app.py"]
