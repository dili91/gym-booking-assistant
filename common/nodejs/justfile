set dotenv-load := true

alias f := format
alias t := test
alias b := bundle
alias d := deploy

test:
    npm test

format: 
    npx prettier . --write

bundle:
    zip -r gym_booking_assistant.zip .

deploy: bundle
    aws lambda update-function-code --region eu-south-1 --function-name GymBookingAssistant --zip-file fileb://gym_booking_assistant.zip