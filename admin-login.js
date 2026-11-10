const form = document.querySelector('#login-form');
const message = document.querySelector('#login-message');

fetch('/api/admin/session').then((response) => {
  if (response.ok) window.location.replace('/admin.html');
}).catch(() => {});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  message.textContent = 'Signing in…';
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: form.username.value, password: form.password.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Sign in failed.');
    window.location.replace('/admin.html');
  } catch (error) {
    message.textContent = error.message || 'The server is unavailable. Please try again.';
  } finally {
    button.disabled = false;
  }
});
