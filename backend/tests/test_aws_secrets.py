"""Secrets come from AWS Secrets Manager in production (app/aws_secrets.py)."""
import json
import sys
import types

import pytest

from app import aws_secrets


def _fake_boto3(monkeypatch, payload, calls):
    class Client:
        def get_secret_value(self, SecretId):
            calls.append(SecretId)
            return {"SecretString": payload}

    mod = types.SimpleNamespace(client=lambda service, region_name=None: Client())
    monkeypatch.setitem(sys.modules, "boto3", mod)


def test_does_nothing_without_a_secret_id(monkeypatch):
    monkeypatch.delenv("APP_SECRETS_ID", raising=False)
    assert aws_secrets.load_into_environ() is False


def test_loads_every_value_into_the_environment(monkeypatch):
    calls = []
    _fake_boto3(monkeypatch, json.dumps({"MONGODB_URI": "mongodb://x/db", "JWT_SECRET_KEY": "k"}), calls)
    monkeypatch.setenv("APP_SECRETS_ID", "bcc-cvote/prod/app")
    monkeypatch.setenv("JWT_SECRET_KEY", "old")
    monkeypatch.delenv("MONGODB_URI", raising=False)
    assert aws_secrets.load_into_environ() is True
    import os
    assert calls == ["bcc-cvote/prod/app"]
    assert os.environ["MONGODB_URI"] == "mongodb://x/db"
    assert os.environ["JWT_SECRET_KEY"] == "k"  # the secret wins


def test_a_broken_secret_stops_startup(monkeypatch):
    _fake_boto3(monkeypatch, json.dumps(["not", "an", "object"]), [])
    monkeypatch.setenv("APP_SECRETS_ID", "bcc-cvote/prod/app")
    with pytest.raises(RuntimeError):
        aws_secrets.load_into_environ()
