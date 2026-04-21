FROM python:3.11-slim

# LibRaw is required by rawpy on ARM; on amd64 the wheel bundles it, but
# installing the runtime lib is cheap insurance and enables source builds.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libraw-dev \
      libjpeg-dev \
      libtiff-dev \
      ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV DATA_ROOT=/data \
    CACHE_ROOT=/cache \
    STATE_ROOT=/state \
    PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
