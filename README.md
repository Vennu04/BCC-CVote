# BCC-CVote 🏏

Cricket Captain Availability Voting App — captains vote their weekend slot availability during a Thu 6PM → Fri 8PM IST window.

## Environments

| Environment | Stack | URL |
|-------------|-------|-----|
| Dev | Docker Compose (local) | http://localhost:5173 |
| Prod | K3s on AWS EC2 t3.micro | http://\<ec2-ip\>:30080 |

---

## Dev Setup (Local)

### Prerequisites
- Docker Desktop running
- Node 20 (optional, for local frontend dev without Docker)

### Start

```bash
git clone https://github.com/Vennu04/BCC-CVote
cd BCC-CVote
cp .env.example .env
# Edit .env: set MONGODB_URI to your Atlas M0 URI
docker compose up -d
```

Seed initial data (first time only):

```bash
docker compose --profile seed up seed
```

App: http://localhost:5173  
Default admin: `ADMIN` / `admin@bcc2024`  
Default captain password: team code in lowercase (e.g. `MI` → `mi`)

### Stop

```bash
docker compose down
```

---

## Prod Setup (K3s on AWS)

### 1. Bootstrap Terraform state bucket

```bash
aws s3 mb s3://bcc-cvote-tfstate --region ap-south-1
aws dynamodb create-table \
  --table-name bcc-cvote-tfstate-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-south-1
```

### 2. Create terraform.tfvars

```hcl
vpc_id        = "vpc-xxxxxxxx"
subnet_id     = "subnet-xxxxxxxx"
key_pair_name = "your-keypair"
admin_cidr    = "YOUR.IP.ADDRESS/32"
```

### 3. Provision infra

```bash
cd terraform
terraform init
terraform apply
```

### 4. Populate Secrets Manager

```bash
# After terraform apply creates the secret placeholders
aws secretsmanager put-secret-value \
  --secret-id bcc-cvote/prod/mongodb-uri \
  --secret-string '{"MONGODB_URI":"mongodb+srv://..."}'

aws secretsmanager put-secret-value \
  --secret-id bcc-cvote/prod/jwt-secret \
  --secret-string '{"JWT_SECRET_KEY":"<32-byte-hex>"}'

aws secretsmanager put-secret-value \
  --secret-id bcc-cvote/prod/app-secret \
  --secret-string '{"SECRET_KEY":"<32-byte-hex>"}'
```

### 5. Configure GitHub Secrets

| Secret | Value |
|--------|-------|
| `AWS_ACCOUNT_ID` | Your AWS account ID |
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN with ECR+Secrets push access |
| `SONAR_TOKEN` | SonarCloud project token |

### 6. Deploy ArgoCD Application

```bash
# SSH into K3s node
ssh ubuntu@<k3s-public-ip>
export KUBECONFIG=/home/ubuntu/.kube/config

# Apply ArgoCD app (points to k8s/prod/)
kubectl apply -f - << 'EOF'
# paste contents of argocd/app-prod.yaml
EOF

# Initial ECR pull secret
/usr/local/bin/refresh-ecr-secret.sh
```

### 7. Push to main → auto-deploy

```bash
git checkout main
git merge develop
git push origin main
# GitHub Actions builds → scans → pushes to ECR → updates k8s/prod/ manifests
# ArgoCD detects manifest change → auto-syncs to K3s
```

---

## Monitoring

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install monitoring prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  -f monitoring/kube-prometheus-values.yaml
```

Grafana: http://\<k3s-ip\>:30300 (admin / changeme-in-prod)

---

## Project Structure

```
BCC-CVote/
├── backend/
│   ├── app/
│   │   ├── __init__.py          # Flask app factory
│   │   ├── config.py            # Dev/Prod config classes
│   │   ├── routes/
│   │   │   ├── auth.py          # /api/auth/*
│   │   │   ├── votes.py         # /api/votes/*, /api/slots
│   │   │   └── admin.py         # /api/admin/*
│   │   └── utils/
│   │       ├── auth.py          # JWT decorators
│   │       ├── time_utils.py    # IST timezone helpers
│   │       └── export.py        # CSV report builder
│   ├── scripts/seed.py          # Seed slots + admin + sample captains
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── gunicorn.conf.py
│   └── run.py
├── frontend/
│   ├── src/
│   │   ├── pages/               # Login, Dashboard, Results, Admin/*
│   │   ├── components/          # Navbar, SlotCard, VoteButton, etc.
│   │   ├── context/AuthContext.jsx
│   │   ├── hooks/useCountdown.js
│   │   ├── utils/api.js
│   │   └── App.jsx
│   ├── Dockerfile
│   └── nginx.conf
├── k8s/prod/                    # K3s manifests (ArgoCD watches this dir)
│   ├── namespace.yaml
│   ├── secret.yaml
│   ├── configmap.yaml
│   ├── backend-deployment.yaml
│   ├── backend-service.yaml
│   ├── frontend-deployment.yaml
│   ├── frontend-service.yaml
│   └── ingress.yaml
├── argocd/app-prod.yaml         # ArgoCD Application resource
├── terraform/                   # EC2 + ECR + Secrets Manager
├── monitoring/                  # Prometheus + Grafana Helm values
├── docker-compose.yml           # DEV ONLY
└── .github/workflows/
    ├── dev-ci.yml               # develop branch: audit + scan + build check
    └── prod-cd.yml              # main branch: build → scan → push → deploy
```

---

## Voting Window Logic

- Admin sets opening (Thu 18:00 IST) and closing (Fri 20:00 IST) datetimes
- All times stored as UTC in MongoDB, displayed in IST
- POST /api/votes returns 403 outside the window
- Dashboard shows live countdown timer
- Admin can close the window early via dashboard
