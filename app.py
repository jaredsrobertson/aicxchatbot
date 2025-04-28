# app.py - Flask application for AI CX Chatbot Demo
# -----------------------------------------------
# Loads environment settings, initializes Dialogflow and OpenAI clients,
# and defines routes for chat interactions and form submissions.

import os
import json
import logging
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from google.cloud import dialogflow_v2 as dialogflow
from openai import OpenAI

# Load environment variables from .env
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# Set Google credentials and project details
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = os.getenv(
    'GOOGLE_APPLICATION_CREDENTIALS', 'service-account.json'
)
PROJECT_ID = os.getenv('DIALOGFLOW_PROJECT_ID', 'aicxassistant-jaeo')
CONFIDENCE_THRESHOLD = float(os.getenv('CONFIDENCE_THRESHOLD', '0.75'))

# Initialize Dialogflow and OpenAI clients
nlp_client = dialogflow.SessionsClient()
openai_client = OpenAI(api_key=os.getenv('OPENAI_KEY'))


def create_app():
    """
    Create and configure the Flask application.
    """
    app = Flask(
        __name__,
        static_folder='static',
        static_url_path=''
    )
    CORS(app, resources={r"/dialogflow": {"origins": "*"}})

    @app.route('/')
    def index():
        # Serve the main HTML page
        return send_from_directory('static', 'index.html')

    def classify_with_gpt(text: str) -> str:
        """
        Use GPT-4o to classify a user message into one of the predefined intents.
        Returns the detected intent as a lowercase string.
        """
        try:
            response = openai_client.chat.completions.create(
                model='gpt-4o',
                messages=[{
                    'role': 'user',
                    'content': (
                        "Classify this message exactly as one of: "
                        "support_request, ticket_status, contact_sales, "
                        "speak_to_agent, or irrelevant. Message: '" + text + "'"
                    )
                }],
                temperature=0,
                max_tokens=10
            )
            intent = response.choices[0].message.content.strip().lower()
            return intent
        except Exception as e:
            log.error(f"GPT classification failed: {e}")
            return 'irrelevant'

    @app.route('/dialogflow', methods=['POST'])
    def dialogflow_proxy():
        """
        Proxy incoming chat messages to Dialogflow or fallback to GPT classification
        when confidence is low. Returns a JSON response with reply text,
        intent name, and any extra payload for modals.
        """
        data = request.get_json(force=True)
        session_id = data.get('sessionId') or data.get('session')
        name = data.get('name', 'User')
        email = data.get('email', '')
        message = data.get('message')
        event = data.get('event')

        session = nlp_client.session_path(PROJECT_ID, session_id)
        if event:
            query_input = dialogflow.QueryInput(
                event=dialogflow.EventInput(name=event, language_code='en')
            )
        else:
            query_input = dialogflow.QueryInput(
                text=dialogflow.TextInput(text=message, language_code='en')
            )

        df_response = nlp_client.detect_intent(
            session=session, query_input=query_input
        )
        result = df_response.query_result
        intent_name = result.intent.display_name
        confidence = result.intent_detection_confidence
        fulfillment = result.fulfillment_text
        payload = {}

        # Extract any webhook payload
        if result.webhook_payload:
            payload = json.loads(
                dialogflow.struct_pb2.Struct.to_json(result.webhook_payload)
            )

        # Fallback with GPT if Dialogflow confidence is below threshold
        if confidence < CONFIDENCE_THRESHOLD:
            fallback_intent = classify_with_gpt(message or '')
            log.info(f"Low confidence ({confidence:.2f}), falling back to GPT -> {fallback_intent}")
            if fallback_intent in ('support_request', 'contact_sales'):
                # Trigger modal form for support or sales
                form_type = 'support' if fallback_intent == 'support_request' else 'sales'
                return jsonify({
                    'reply': f"Opening {'support ticket' if form_type=='support' else 'sales inquiry'} form...",
                    'intent': fallback_intent,
                    'payload': {'confirm_modal': form_type},
                    'gpt_fallback': True
                })
            # Generic fallback reply
            return jsonify({
                'reply': 'Let me help with that—please choose an option below.',
                'intent': fallback_intent,
                'payload': {},
                'gpt_fallback': True
            })

        # Standard Dialogflow response
        return jsonify({
            'reply': fulfillment,
            'intent': intent_name,
            'payload': payload,
            'gpt_fallback': False
        })

    @app.route('/modal-submit', methods=['POST'])
    def modal_submit():
        """
        Receive data from support/sales modals and append to a log file.
        """
        data = request.get_json(force=True)
        entry = {
            'action': data.get('action'),
            'name': data.get('name'),
            'email': data.get('email'),
            'message': data.get('message', data.get('subject') or data.get('company', ''))
        }
        try:
            with open('conversations.json', 'a') as file:
                file.write(json.dumps(entry) + '\n')
        except Exception as e:
            log.error(f"Error writing to conversations log: {e}")
        return jsonify({'status': 'ok'})

    return app


if __name__ == '__main__':
    # Run the Flask development server on port 5000
    create_app().run(host='0.0.0.0', port=5000)