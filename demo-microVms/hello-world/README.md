# Hello World - Lambda MicroVM

App Flask mínima corriendo en una Lambda MicroVM con lifecycle hooks.

## Prerequisitos

- AWS CLI >= 2.35 con soporte para `lambda-microvms`
- Profile `sso-personal` configurado y autenticado (`aws sso login --profile sso-personal`)

## Variables

```bash
export AWS_PROFILE=sso-personal
export AWS_REGION=us-east-1
export ACCOUNT_ID=590183999298
export BUCKET=microvm-artifacts-${ACCOUNT_ID}-${AWS_REGION}
```

## 1. Crear IAM Roles

### Build Role

```bash
aws iam create-role --role-name MicroVMBuildRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole",
      "Condition": {"StringEquals": {"aws:SourceAccount": "'$ACCOUNT_ID'"}}
    }]
  }'

aws iam put-role-policy --role-name MicroVMBuildRole \
  --policy-name MicroVMBuildPolicy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {"Effect": "Allow", "Action": ["s3:GetObject"], "Resource": "arn:aws:s3:::'$BUCKET'/*"},
      {"Effect": "Allow", "Action": ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"], "Resource": "arn:aws:logs:'$AWS_REGION':'$ACCOUNT_ID':log-group:/aws/lambda-microvms/*"}
    ]
  }'
```

### Execution Role

```bash
aws iam create-role --role-name MicroVMExecutionRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole",
      "Condition": {"StringEquals": {"aws:SourceAccount": "'$ACCOUNT_ID'"}}
    }]
  }'

aws iam put-role-policy --role-name MicroVMExecutionRole \
  --policy-name MicroVMExecutionPolicy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {"Effect": "Allow", "Action": ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"], "Resource": "arn:aws:logs:'$AWS_REGION':'$ACCOUNT_ID':log-group:/aws/lambda-microvms/*"}
    ]
  }'
```

## 2. Crear bucket S3 y subir artefacto

```bash
aws s3api create-bucket --bucket $BUCKET

zip hello-world.zip Dockerfile app.py
aws s3 cp hello-world.zip s3://$BUCKET/microvm-images/hello-world/code-artifact.zip
```

## 3. Crear la imagen MicroVM

```bash
aws lambda-microvms create-microvm-image \
  --name hello-world \
  --description "Hello world Flask MicroVM" \
  --base-image-arn arn:aws:lambda:${AWS_REGION}:aws:microvm-image:al2023-1 \
  --build-role-arn arn:aws:iam::${ACCOUNT_ID}:role/MicroVMBuildRole \
  --code-artifact '{"uri":"s3://'$BUCKET'/microvm-images/hello-world/code-artifact.zip"}' \
  --hooks '{"port":9000,"microvmImageHooks":{"ready":"ENABLED","readyTimeoutInSeconds":60},"microvmHooks":{"run":"ENABLED","runTimeoutInSeconds":2,"resume":"ENABLED","resumeTimeoutInSeconds":2,"suspend":"ENABLED","suspendTimeoutInSeconds":5,"terminate":"ENABLED","terminateTimeoutInSeconds":5}}'
```

Esperar a que el estado sea `CREATED`:

```bash
aws lambda-microvms get-microvm-image \
  --image-identifier arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:microvm-image:hello-world \
  --query 'state' --output text
```

## 4. Ejecutar la MicroVM

```bash
aws lambda-microvms run-microvm \
  --image-identifier arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:microvm-image:hello-world \
  --image-version 1.0 \
  --execution-role-arn arn:aws:iam::${ACCOUNT_ID}:role/MicroVMExecutionRole \
  --idle-policy '{"maxIdleDurationSeconds":900,"suspendedDurationSeconds":300,"autoResumeEnabled":true}'
```

Anotar el `microvmId` y `endpoint` del output.

## 5. Probar

```bash
MICROVM_ID=microvm-...  # reemplazar con el ID del paso anterior
ENDPOINT=...            # reemplazar con el endpoint del paso anterior

TOKEN=$(aws lambda-microvms create-microvm-auth-token \
  --microvm-identifier $MICROVM_ID \
  --expiration-in-minutes 30 \
  --allowed-ports '[{"port":8080}]' \
  --query 'authToken."X-aws-proxy-auth"' --output text)

curl "https://$ENDPOINT/" -H "X-aws-proxy-auth: $TOKEN" -H "X-aws-proxy-port: 8080"
# => {"hello":"world"}
```

## 6. Terminar

```bash
aws lambda-microvms terminate-microvm --microvm-identifier $MICROVM_ID
```

## Limpieza completa

```bash
aws lambda-microvms delete-microvm-image \
  --image-identifier arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:microvm-image:hello-world
aws s3 rm s3://$BUCKET/microvm-images/hello-world/code-artifact.zip
aws s3api delete-bucket --bucket $BUCKET
aws iam delete-role-policy --role-name MicroVMBuildRole --policy-name MicroVMBuildPolicy
aws iam delete-role --role-name MicroVMBuildRole
aws iam delete-role-policy --role-name MicroVMExecutionRole --policy-name MicroVMExecutionPolicy
aws iam delete-role --role-name MicroVMExecutionRole
```
