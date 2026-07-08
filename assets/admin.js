document.addEventListener('DOMContentLoaded', () => {
  const authShell = document.getElementById('authShell');
  const adminApp = document.getElementById('adminApp');
  const authForm = document.getElementById('authForm');
  const authPassword = document.getElementById('authPassword');
  const authConfirm = document.getElementById('authConfirm');
  const authError = document.getElementById('authError');
  const confirmField = document.getElementById('confirmField');
  const productDialog = document.getElementById('productDialog');
  let setupMode = false;
  let products = [];

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const titleCase = value => value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
  const api = async (url, options = {}) => {
    const config = { credentials: 'same-origin', ...options };
    if (config.body && typeof config.body !== 'string') {
      config.body = JSON.stringify(config.body);
      config.headers = { ...config.headers, 'Content-Type': 'application/json', 'X-Requested-With': 'ApexAdmin' };
    }
    const response = await fetch(url, config);
    let data = {};
    try { data = await response.json(); } catch (_) { data = {}; }
    if (!response.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  };

  const toast = message => {
    const element = document.getElementById('adminToast');
    element.textContent = message;
    element.classList.add('show');
    window.clearTimeout(element.toastTimer);
    element.toastTimer = window.setTimeout(() => element.classList.remove('show'), 3200);
  };

  const showApp = async () => {
    authShell.classList.add('is-hidden');
    adminApp.classList.remove('is-hidden');
    await Promise.all([loadProducts(), loadSite()]);
  };

  const configureAuth = configured => {
    setupMode = !configured;
    document.getElementById('authKicker').textContent = setupMode ? 'First-time setup' : 'Protected access';
    document.getElementById('authTitle').textContent = setupMode ? 'Create admin access.' : 'Welcome back.';
    document.getElementById('authCopy').textContent = setupMode ? 'Choose a strong password for the Apex administration console.' : 'Enter your administrator password to continue.';
    document.getElementById('authButton').textContent = setupMode ? 'Create password' : 'Sign in';
    confirmField.classList.toggle('is-hidden', !setupMode);
    authPassword.autocomplete = setupMode ? 'new-password' : 'current-password';
  };

  const initialise = async () => {
    try {
      const status = await api('/api/admin/status');
      if (status.authenticated) await showApp();
      else configureAuth(status.configured);
    } catch (error) {
      authError.textContent = 'The admin server is unavailable. Start the site with python3 server.py.';
    }
  };

  authForm.addEventListener('submit', async event => {
    event.preventDefault();
    authError.textContent = '';
    const password = authPassword.value;
    if (setupMode && password !== authConfirm.value) {
      authError.textContent = 'Passwords do not match.';
      return;
    }
    try {
      await api(setupMode ? '/api/admin/setup' : '/api/admin/login', { method: 'POST', body: { password } });
      authForm.reset();
      await showApp();
    } catch (error) { authError.textContent = error.message; }
  });

  const loadProducts = async () => {
    const data = await api('/api/admin/products');
    products = data.products;
    renderProducts();
  };

  const renderProducts = () => {
    const rows = document.getElementById('productRows');
    document.getElementById('productEmpty').classList.toggle('is-hidden', products.length > 0);
    rows.innerHTML = products.map(product => `
      <tr>
        <td><div class="admin-material"><span class="admin-swatch" style="background:${escapeHtml(product.swatch)}"></span><div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.description.slice(0, 55))}${product.description.length > 55 ? '…' : ''}</small></div></div></td>
        <td>${escapeHtml(titleCase(product.category))}</td><td>${escapeHtml(product.code)}</td><td>${product.sort_order}</td>
        <td><div class="table-actions"><button data-edit-product="${product.id}">Edit</button><button class="danger" data-delete-product="${product.id}">Delete</button></div></td>
      </tr>`).join('');
  };

  const openProduct = product => {
    document.getElementById('dialogTitle').textContent = product ? 'Edit product' : 'Add product';
    document.getElementById('productId').value = product?.id || '';
    document.getElementById('productName').value = product?.name || '';
    document.getElementById('productCode').value = product?.code || '';
    document.getElementById('productCategory').value = product?.category || 'automotive';
    document.getElementById('productSwatch').value = product?.swatch || '#a64128';
    document.getElementById('productSwatchText').value = product?.swatch || '#a64128';
    document.getElementById('productDescription').value = product?.description || '';
    document.getElementById('productProperties').value = product?.properties?.join(', ') || '';
    document.getElementById('productOrder').value = product?.sort_order ?? products.length;
    document.getElementById('productError').textContent = '';
    productDialog.showModal();
  };

  document.getElementById('addProductButton').addEventListener('click', () => openProduct(null));
  document.getElementById('dialogClose').addEventListener('click', () => productDialog.close());
  document.getElementById('dialogCancel').addEventListener('click', () => productDialog.close());
  document.getElementById('productRows').addEventListener('click', async event => {
    const edit = event.target.closest('[data-edit-product]');
    const remove = event.target.closest('[data-delete-product]');
    if (edit) openProduct(products.find(product => product.id === Number(edit.dataset.editProduct)));
    if (remove) {
      const product = products.find(item => item.id === Number(remove.dataset.deleteProduct));
      if (!window.confirm(`Delete ${product.name}? This removes it from the public catalogue.`)) return;
      try {
        await api(`/api/admin/products/${product.id}`, { method: 'DELETE', headers: { 'X-Requested-With': 'ApexAdmin' } });
        await loadProducts();
        toast('Product deleted.');
      } catch (error) { toast(error.message); }
    }
  });

  const swatch = document.getElementById('productSwatch');
  const swatchText = document.getElementById('productSwatchText');
  swatch.addEventListener('input', () => { swatchText.value = swatch.value; });
  swatchText.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(swatchText.value)) swatch.value = swatchText.value; });

  document.getElementById('productForm').addEventListener('submit', async event => {
    event.preventDefault();
    const id = document.getElementById('productId').value;
    const payload = {
      name: document.getElementById('productName').value,
      code: document.getElementById('productCode').value,
      category: document.getElementById('productCategory').value,
      swatch: swatchText.value,
      description: document.getElementById('productDescription').value,
      properties: document.getElementById('productProperties').value,
      sort_order: document.getElementById('productOrder').value
    };
    try {
      await api(id ? `/api/admin/products/${id}` : '/api/admin/products', { method: id ? 'PUT' : 'POST', body: payload });
      productDialog.close();
      await loadProducts();
      toast(id ? 'Product updated.' : 'Product added to the catalogue.');
    } catch (error) { document.getElementById('productError').textContent = error.message; }
  });

  const loadSite = async () => {
    const data = await api('/api/admin/site');
    Object.entries(data.site).forEach(([key, value]) => {
      const field = document.querySelector(`#siteForm [name="${key}"]`);
      if (field) field.value = value;
    });
  };

  document.getElementById('siteForm').addEventListener('submit', async event => {
    event.preventDefault();
    const errorElement = document.getElementById('siteError');
    errorElement.textContent = '';
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api('/api/admin/site', { method: 'PUT', body: payload });
      toast('Company details saved.');
    } catch (error) { errorElement.textContent = error.message; }
  });

  document.getElementById('passwordForm').addEventListener('submit', async event => {
    event.preventDefault();
    const errorElement = document.getElementById('passwordError');
    errorElement.textContent = '';
    const current = document.getElementById('currentPassword').value;
    const next = document.getElementById('newPassword').value;
    if (next !== document.getElementById('confirmPassword').value) {
      errorElement.textContent = 'New passwords do not match.';
      return;
    }
    try {
      await api('/api/admin/password', { method: 'PUT', body: { current_password: current, new_password: next } });
      event.currentTarget.reset();
      toast('Password updated.');
    } catch (error) { errorElement.textContent = error.message; }
  });

  document.querySelectorAll('[data-admin-tab]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-admin-tab]').forEach(item => item.classList.toggle('active', item === button));
    document.querySelectorAll('[data-admin-panel]').forEach(panel => panel.classList.toggle('is-hidden', panel.dataset.adminPanel !== button.dataset.adminTab));
    document.getElementById('sectionTitle').textContent = button.textContent.replace(/^\d+/, '').trim();
  }));

  document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api('/api/admin/logout', { method: 'POST' });
      window.location.reload();
    } catch (error) {
      button.disabled = false;
      toast(error.message);
    }
  }));

  initialise();
});
