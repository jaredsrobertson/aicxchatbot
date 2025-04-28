// chat.js - client-side logic for chat widget interactions

(() => {
  // Configuration constants
  const API_BASE = window.location.origin;
  const BOT_DELAY = 500; // Delay in ms before executing bot callbacks

  // Generate or retrieve session ID to maintain conversation state
  const sessionId = (() => {
    let id = sessionStorage.getItem('session_id');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('session_id', id);
    }
    return id;
  })();

  // DOM element references
  const container = document.getElementById('chat-container');
  const launcher = document.getElementById('chat-launcher');
  const chatWrapper = document.getElementById('chatbox');
  const navCta = document.getElementById('nav-cta');
  const heroTry = document.getElementById('hero-try');

  let userName = 'User';
  let userEmail = 'anonymous@example.com';

  // Initialize launcher animations and click handlers
  function setupLauncher() {
    setTimeout(() => launcher.classList.add('active'), 500);
    launcher.addEventListener('click', toggleChat);
    navCta.addEventListener('click', toggleChat);
    heroTry.addEventListener('click', toggleChat);
  }

  // Toggle chat visibility and reset content when closing
  function toggleChat() {
    const opening = !chatWrapper.classList.contains('visible');
    chatWrapper.classList.toggle('visible', opening);
    container.classList.toggle('open', opening);
    if (opening) showPrechat();
    else chatWrapper.innerHTML = '';
  }

  // Display the pre-chat form for name/email capture
  function showPrechat() {
    chatWrapper.innerHTML = `
      <div id="chat-header">
        Support Bot
        <button class="chat-header-close">&times;</button>
      </div>
      <div id="chat-messages" class="prechat">
        <input id="name-input" placeholder="Your name" value="John Doe" />
        <input id="email-input" placeholder="Your email" value="john.doe@example.com" />
        <button id="start-chat">Start Chat</button>
      </div>
      <div class="input-container">
        <input id="user-input" disabled placeholder="Type your message…" />
        <button id="send-btn" disabled><i class="fas fa-play"></i></button>
      </div>`;

    // Close button for pre-chat
    document.querySelector('.chat-header-close').addEventListener('click', toggleChat);
    document.getElementById('start-chat').addEventListener('click', startChat);
  }

  // Build main chat interface after capturing user info
  function startChat() {
    const rawName = document.getElementById('name-input').value.trim();
    const rawEmail = document.getElementById('email-input').value.trim();
    userName = rawName.split(' ')[0] || 'User';
    userEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)
      ? rawEmail.toLowerCase()
      : 'anonymous@example.com';

    chatWrapper.innerHTML = `
      <div id="chat-header">
        Support Bot
        <button class="chat-header-close">&times;</button>
      </div>
      <div id="chat-messages"></div>
      <div class="input-container">
        <input id="user-input" placeholder="Type your message…" />
        <button id="send-btn"><i class="fas fa-play"></i></button>
      </div>`;

    // Attach handlers for sending messages
    document.querySelector('.chat-header-close').addEventListener('click', toggleChat);
    document.getElementById('send-btn').addEventListener('click', () => sendMessage());
    document.getElementById('user-input').addEventListener('keypress', e => {
      if (e.key === 'Enter') sendMessage();
    });

    // Welcome messages
    addBotMessage('This chat is recorded.');
    addBotMessage(`Hi ${userName}! How can I help?`);
    showMainMenu();
  }

  // Send user message to server and render reply
  async function sendMessage(text) {
    text = text || document.getElementById('user-input').value.trim();
    if (!text) return;

    addUserMessage(text);
    document.getElementById('user-input').value = '';
    clearSuggestions();

    try {
      const response = await postJSON('/dialogflow', {
        sessionId,
        name: userName,
        email: userEmail,
        message: text
      });
      const replyText = response.reply.replace(/\$session\.params\.name/g, userName);
      addBotMessage(replyText, () => {
        if (response.payload?.confirm_modal) {
          showModal(response.payload.confirm_modal);
        } else {
          showContextMenu(response.intent);
        }
      });
    } catch {
      addBotMessage('Sorry, something went wrong.');
    }
  }

  // Helper for POST requests with JSON
  function postJSON(path, body) {
    return fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(res => res.json());
  }

  // Render a user message bubble in the chat
  function addUserMessage(text) {
    const bubble = document.createElement('div');
    bubble.className = 'message user';
    bubble.textContent = text;
    document.getElementById('chat-messages').append(bubble);
    bubble.scrollIntoView({ behavior: 'smooth' });
  }

  // Render a bot message bubble and optionally execute a callback
  function addBotMessage(text, callback) {
    const bubble = document.createElement('div');
    bubble.className = 'message bot';
    bubble.textContent = text;
    document.getElementById('chat-messages').append(bubble);
    bubble.scrollIntoView({ behavior: 'smooth' });
    if (callback) setTimeout(callback, BOT_DELAY);
  }

  // Display quick-reply suggestions as buttons
  function showSuggestions(options) {
    clearSuggestions();
    const container = document.getElementById('chat-messages');
    const wrapper = document.createElement('div');
    wrapper.className = 'suggestions';
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.textContent = opt.label;
      btn.onclick = () => {
        addUserMessage(opt.label);
        postEvent(opt.event);
      };
      wrapper.append(btn);
    });
    container.append(wrapper);
    wrapper.scrollIntoView({ behavior: 'smooth' });
  }

  // Remove any existing suggestion buttons
  function clearSuggestions() {
    document.querySelectorAll('.suggestions').forEach(el => el.remove());
  }

  // Send a Dialogflow event or open modal for support/sales
  function postEvent(event) {
    if (event === 'SUPPORT_REQUEST') return showModal('support');
    if (event === 'CONTACT_SALES') return showModal('sales');
    postJSON('/dialogflow', { sessionId, name: userName, email: userEmail, event })
      .then(res => {
        addBotMessage(res.reply, () => {
          if (res.payload?.confirm_modal) showModal(res.payload.confirm_modal);
          else showContextMenu(res.intent);
        });
      })
      .catch(() => addBotMessage('Error handling event'));
  }

  // Initial quick-reply menu options
  function showMainMenu() {
    showSuggestions([
      { label: 'Submit support ticket', event: 'SUPPORT_REQUEST' },
      { label: 'Check ticket status', event: 'TICKET_STATUS' },
      { label: 'Contact Sales', event: 'CONTACT_SALES' },
      { label: 'Speak to Agent', event: 'SPEAK_TO_AGENT' }
    ]);
  }

  // Contextual quick-reply options based on intent
  function showContextMenu(intent) {
    const map = {
      support_request: ['Check ticket status', 'Speak to Agent'],
      ticket_status:   ['Submit support ticket', 'Speak to Agent']
    };
    const options = map[intent] || ['Submit support ticket', 'Check ticket status', 'Contact Sales', 'Speak to Agent'];
    showSuggestions(options.map(label => ({ label, event: label.toUpperCase().replace(/ /g,'_') })));
  }

  // Display a modal dialog for support or sales form submission
  function showModal(type) {
    const isSupport = type === 'support';
    const title = isSupport ? 'Submit Support Ticket' : 'Contact Sales';
    const fields = isSupport
      ? `<input id="modal-subject" class="modal-input" placeholder="Subject" />
         <textarea id="modal-msg" class="modal-textarea" placeholder="Describe your issue"></textarea>`
      : `<input id="modal-company" class="modal-input" placeholder="Company Name" />
         <textarea id="modal-msg" class="modal-textarea" placeholder="Your inquiry"></textarea>`;

    const modal = document.createElement('div');
    modal.id = 'chat-modal';
    modal.innerHTML = `
      <h3>${title}</h3>
      ${fields}
      <div class="modal-actions">
        <button id="modal-cancel" class="modal-btn modal-btn-secondary">Cancel</button>
        <button id="modal-submit" class="modal-btn modal-btn-primary">Submit</button>
      </div>`;
    document.body.append(modal);
    setTimeout(() => modal.classList.add('modal-visible'), 10);

    modal.querySelector('#modal-cancel').onclick = () => modal.remove();
    modal.querySelector('#modal-submit').onclick = () => {
      const formData = { action: type, name: userName, email: userEmail };
      if (isSupport) {
        formData.subject = modal.querySelector('#modal-subject').value.trim();
        formData.message = modal.querySelector('#modal-msg').value.trim();
      } else {
        formData.company = modal.querySelector('#modal-company').value.trim();
        formData.message = modal.querySelector('#modal-msg').value.trim();
      }
      postJSON('/modal-submit', formData).then(() => {
        modal.remove();
        addBotMessage('Thanks! We will be in touch.');
        showRating();
      });
    };
  }

  // Prompt user to rate their experience after form submission
  function showRating() {
    const container = document.createElement('div');
    container.className = 'rating-container';
    container.innerHTML = '<p>Rate your experience:</p>' +
      [1,2,3,4,5].map(i => `<button data-rating="${i}">${i}</button>`).join('');
    document.getElementById('chat-messages').append(container);
    container.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        addBotMessage(`You rated us ${btn.dataset.rating} stars. Thank you!`);
        container.remove();
      };
    });
    container.scrollIntoView({ behavior: 'smooth' });
  }

  // Kick off the chat launcher behavior
  setupLauncher();
})();