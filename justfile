set dotenv-load := true

alias t := test

test:
    APPLICATION_ID=ec1d38d7-d359-48d0-a60c-d8c0b8fb9df9 \
    CLIENT_ID=mywellnessappios40 \
    node -e "require('./index.js').handler();"