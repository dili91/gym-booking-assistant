set dotenv-load := true

AWS_REGION := "eu-south-1"

alias f := format
alias r := run
alias t := test
alias d := deploy-lambda-function

test:
    mkdir -p /opt/nodejs
    find "$(pwd -P)/common/nodejs" -name "*.js" -maxdepth 1 -exec ln -s "{}" /opt/nodejs/ ';'
    cd scan && npm test

run:
    mkdir -p /opt/nodejs
    find "$(pwd -P)/common/nodejs" -name "*.js" -maxdepth 1 -exec ln -s "{}" /opt/nodejs/ ';'
    cd scan && npm run run-local

format: 
    npx prettier . --write

deploy-lambda-layer:
    cd ./common && zip -r lambda_layer.zip .
    aws lambda publish-layer-version \
    --no-cli-pager \
    --region {{AWS_REGION}} \
    --layer-name GymBookingAssistantCommonLayer \
    --compatible-runtimes nodejs20.x \
    --zip-file fileb://common/lambda_layer.zip \

deploy-lambda-function:
    cd ./scan && zip -r gym_booking_assistant.zip .
    aws lambda update-function-code \
    --no-cli-pager \
    --region {{AWS_REGION}} \
    --function-name GymBookingAssistant \
    --zip-file fileb://scan/gym_booking_assistant.zip