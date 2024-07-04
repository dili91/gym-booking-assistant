set dotenv-load := true

AWS_REGION := "eu-south-1"

alias f := format
alias r := run
alias t := test

requirements:
    sudo mkdir -p /opt/nodejs
    sudo find "$(pwd -P)/common/nodejs" -name "*.js" -maxdepth 1 -exec ln -s "{}" /opt/nodejs ';'

test: requirements
    cd scan && npm test
    cd common/nodejs && npm test
run: requirements
    cd scan && npm run run-local

format: 
    npx prettier . --write

deploy-layer:
    cd ./common && zip -r lambda_layer.zip .
    aws lambda publish-layer-version \
    --no-cli-pager \
    --region {{AWS_REGION}} \
    --layer-name GymBookingAssistantCommonLayer \
    --compatible-runtimes nodejs20.x \
    --zip-file fileb://common/lambda_layer.zip \

deploy-scan-function:
    cd ./scan && zip -r scan.zip .
    aws lambda update-function-code \
    --no-cli-pager \
    --region {{AWS_REGION}} \
    --function-name GymBookingAssistant_Scan \
    --zip-file fileb://scan/scan.zip

deploy-book-function:
    cd ./book && zip -r book.zip .
    aws lambda update-function-code \
    --no-cli-pager \
    --region {{AWS_REGION}} \
    --function-name GymBookingAssistant_Book \
    --zip-file fileb://book/book.zip