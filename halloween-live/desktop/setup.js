document.querySelector('form').addEventListener('submit', async event => {
  event.preventDefault(); const button = document.querySelector('button'); button.disabled = true;
  try { await window.pivnikDesktop.setBackend(new FormData(event.currentTarget).get('origin')); }
  catch { document.querySelector('#error').textContent = 'Не удалось подключиться. Проверьте HTTPS-адрес и доступность сервера.'; }
  finally { button.disabled = false; }
});
