const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateLabel = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'America/Sao_Paulo' });

const state = { services: [], serviceId: '', date: '', time: '', step: 1, submitting: false };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function setStatus(message = '', error = false) {
  const status = $('#booking-status');
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

function localISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function setDateBounds() {
  const input = $('#booking-date');
  const minimum = new Date();
  const maximum = new Date();
  maximum.setDate(maximum.getDate() + 30);
  input.min = localISODate(minimum);
  input.max = localISODate(maximum);
}

function renderServices() {
  $('#booking-services').innerHTML = state.services.map((service) => `
    <label class="booking-option">
      <input type="radio" name="serviceId" value="${service.id}" ${service.id === state.serviceId ? 'checked' : ''}>
      <strong>${service.name}</strong>
      <small>${service.durationMinutes} min · ${currency.format(service.priceCents / 100)}</small>
    </label>`).join('');
}

async function loadServices() {
  const nextButtons = $$('[data-next]');
  nextButtons.forEach((button) => { button.disabled = true; });
  setStatus('Carregando serviços…');
  try {
    const response = await fetch('/api/services', { headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Não foi possível carregar os serviços.');
    state.services = body.services;
    renderServices();
    setStatus('');
    nextButtons.forEach((button) => { button.disabled = false; });
  } catch (error) {
    setStatus(`${error.message} A confirmação permanecerá desabilitada até o Supabase ser configurado.`, true);
  }
}

function selectService(id) {
  if (!state.services.some((service) => service.id === id)) return;
  state.serviceId = id;
  renderServices();
}

async function loadAvailability() {
  const slots = $('#slots');
  state.time = '';
  if (!state.serviceId || !state.date) { slots.innerHTML = ''; return; }
  slots.innerHTML = '<p class="slots__empty">Consultando horários…</p>';
  setStatus('');
  try {
    const params = new URLSearchParams({ serviceId: state.serviceId, date: state.date });
    const response = await fetch(`/api/availability?${params}`, { headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Não foi possível consultar a agenda.');
    if (!body.slots.length) {
      slots.innerHTML = '<p class="slots__empty">Não há horários disponíveis nesta data. Escolha outro dia.</p>';
      return;
    }
    slots.innerHTML = body.slots.map((time) => `<button class="slot" type="button" data-time="${time}" aria-pressed="false">${time}</button>`).join('');
  } catch (error) {
    slots.innerHTML = '<p class="slots__empty">A agenda não pôde ser carregada.</p>';
    setStatus(error.message, true);
  }
}

function validateStep() {
  if (state.step === 1 && !state.serviceId) { setStatus('Escolha um serviço para continuar.', true); return false; }
  if (state.step === 2 && (!state.date || !state.time)) { setStatus('Escolha uma data e um horário disponível.', true); return false; }
  if (state.step === 3) {
    const name = $('#customer-name');
    const phone = $('#customer-phone');
    if (!name.checkValidity() || name.value.trim().length < 2) { name.reportValidity(); setStatus('Informe seu nome.', true); return false; }
    if (!phone.checkValidity() || phone.value.replace(/\D/g, '').length < 10) { phone.setCustomValidity('Informe um telefone com DDD.'); phone.reportValidity(); phone.setCustomValidity(''); setStatus('Informe um telefone válido com DDD.', true); return false; }
  }
  return true;
}

function showStep(step) {
  state.step = step;
  $$('.booking-step').forEach((element) => { element.hidden = Number(element.dataset.step) !== step; });
  $$('.booking__progress span').forEach((element, index) => element.classList.toggle('is-active', index + 1 === step));
  setStatus('');
  if (step === 4) renderSummary();
  $('.booking__panel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
}

function renderSummary() {
  const service = state.services.find((item) => item.id === state.serviceId);
  const parsedDate = new Date(`${state.date}T12:00:00`);
  const rows = [['Serviço', service.name], ['Data', dateLabel.format(parsedDate)], ['Horário', state.time], ['Duração', `${service.durationMinutes} minutos`], ['Valor demonstrativo', currency.format(service.priceCents / 100)], ['Nome', $('#customer-name').value.trim()], ['Telefone', $('#customer-phone').value.trim()]];
  $('#booking-summary').innerHTML = rows.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join('');
}

async function submitBooking(event) {
  event.preventDefault();
  if (state.submitting || !$('#demo-consent').checked) { $('#demo-consent').reportValidity(); return; }
  state.submitting = true;
  const button = $('#confirm-booking');
  button.disabled = true;
  button.textContent = 'Confirmando…';
  setStatus('Enviando sua reserva…');
  try {
    const payload = { serviceId: state.serviceId, date: state.date, time: state.time, customerName: $('#customer-name').value.trim(), customerPhone: $('#customer-phone').value.trim() };
    const response = await fetch('/api/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 409) { await loadAvailability(); showStep(2); throw new Error('Esse horário acabou de ser reservado. A agenda foi atualizada para você escolher outro.'); }
      throw new Error(body.error || 'Não foi possível confirmar a reserva. Tente novamente.');
    }
    $('#booking-form').hidden = true;
    $('.booking__progress').hidden = true;
    setStatus('');
    const service = state.services.find((item) => item.id === state.serviceId);
    $('#success-copy').textContent = `${service.name}, ${dateLabel.format(new Date(`${state.date}T12:00:00`))}, às ${state.time}. Código ${body.appointment.id.slice(0, 8).toUpperCase()}.`;
    $('#booking-success').hidden = false;
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    state.submitting = false;
    button.disabled = false;
    button.textContent = 'Confirmar reserva';
  }
}

function resetBooking() {
  Object.assign(state, { serviceId: '', date: '', time: '', step: 1, submitting: false });
  $('#booking-form').reset();
  $('#booking-form').hidden = false;
  $('.booking__progress').hidden = false;
  $('#booking-success').hidden = true;
  $('#slots').innerHTML = '';
  renderServices();
  showStep(1);
}

export function initBooking() {
  if (!$('[data-booking-app]')) return;
  setDateBounds();
  loadServices();
  $('#booking-services').addEventListener('change', (event) => selectService(event.target.value));
  $('#booking-date').addEventListener('change', (event) => { state.date = event.target.value; loadAvailability(); });
  $('#slots').addEventListener('click', (event) => {
    const button = event.target.closest('[data-time]');
    if (!button) return;
    state.time = button.dataset.time;
    $$('.slot').forEach((slot) => { const selected = slot === button; slot.classList.toggle('is-selected', selected); slot.setAttribute('aria-pressed', String(selected)); });
  });
  $$('[data-next]').forEach((button) => button.addEventListener('click', () => { if (validateStep()) showStep(Math.min(4, state.step + 1)); }));
  $$('[data-prev]').forEach((button) => button.addEventListener('click', () => showStep(Math.max(1, state.step - 1))));
  $('#booking-form').addEventListener('submit', submitBooking);
  $('#new-booking').addEventListener('click', resetBooking);
  $$('[data-book-service]').forEach((link) => link.addEventListener('click', () => {
    const id = link.dataset.bookService;
    let attempts = 0;
    const waitForServices = () => {
      if (state.services.length) { selectService(id); showStep(2); return; }
      attempts += 1;
      if (attempts < 30) setTimeout(waitForServices, 100);
      else setStatus('Configure o Supabase para selecionar e confirmar um serviço.', true);
    };
    waitForServices();
  }));
}
