"""Loads this app's secrets from AWS Secrets Manager at startup.

In production the container only gets APP_SECRETS_ID (the secret's name);
the values themselves are fetched here with the server's instance role and
placed in this process's environment, before config.py reads it. They are
never written to disk, never part of the container's configuration (so not
visible in `docker inspect`), and never logged.

Without APP_SECRETS_ID (tests, local dev) this does nothing and the normal
environment variables apply. If the secret can't be read, startup fails
loudly — better a container that won't start (and a failed deploy) than an
app silently running with fallback dev keys.
"""
import json
import os


def load_into_environ():
    secret_id = os.environ.get("APP_SECRETS_ID")
    if not secret_id:
        return False

    import boto3  # only needed in production

    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "ap-south-1"
    client = boto3.client("secretsmanager", region_name=region)
    values = json.loads(client.get_secret_value(SecretId=secret_id)["SecretString"])
    if not isinstance(values, dict):
        raise RuntimeError(f"Secret {secret_id} must be a JSON object of settings")
    for key, value in values.items():
        if isinstance(value, str):
            os.environ[key] = value
    return True
