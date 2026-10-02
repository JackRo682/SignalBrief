FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /app
COPY pyproject.toml alembic.ini ./
COPY apps/api ./apps/api
COPY supabase ./supabase
COPY evals ./evals
RUN pip install --no-cache-dir . && useradd --create-home --uid 10001 app && mkdir -p /app/var/raw && chown -R app:app /app
USER app
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn signalbrief.app:app --host 0.0.0.0 --port ${PORT}"]
