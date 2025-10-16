# LocalStack Demo — S3 & DynamoDB

Aplicação simples em **Node.js + Express** usando o **LocalStack** para simular os serviços **S3** (armazenamento de arquivos) e **DynamoDB** (cadastro/autenticação de usuários).

---

## 🚀 Como rodar

### 1. Subir o LocalStack

Na raiz do projeto, execute:

```bash
docker compose up -d
```

### 2. Criar o bucket e a tabela

```bash
docker exec -it localstack awslocal s3api create-bucket --bucket app-uploads

docker exec -it localstack awslocal dynamodb create-table \
  --table-name users \
  --attribute-definitions AttributeName=email,AttributeType=S \
  --key-schema AttributeName=email,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

### 3. Configurar o backend

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

### 4. Acessar a interface

```bash
http://localhost:3000
```
