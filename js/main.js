import { initBooking } from './booking.js';

document.documentElement.classList.add('js');

const header = document.querySelector('[data-header]');
const menuButton = document.querySelector('.menu-toggle');
const menu = document.querySelector('.site-nav');

const updateHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 80);
updateHeader();
window.addEventListener('scroll', updateHeader, { passive: true });

menuButton.addEventListener('click', () => {
  const open = menu.classList.toggle('is-open');
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.querySelector('.sr-only').textContent = open ? 'Fechar menu' : 'Abrir menu';
});
menu.addEventListener('click', (event) => {
  if (event.target.closest('a')) {
    menu.classList.remove('is-open');
    menuButton.setAttribute('aria-expanded', 'false');
  }
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => entry.target.classList.toggle('is-visible', entry.isIntersecting));
}, { threshold: 0.12, rootMargin: '0px 0px -40px' });
document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));

document.querySelectorAll('details').forEach((item) => item.addEventListener('toggle', () => {
  if (!item.open) return;
  document.querySelectorAll('details[open]').forEach((other) => { if (other !== item) other.open = false; });
}));

initBooking();
