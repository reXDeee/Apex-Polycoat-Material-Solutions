import { defaultProducts, getCategories, getProducts, getSite } from "./firebase-service.js";

const ENQUIRY_ENDPOINT = "https://formsubmit.co/ajax/contact@apexpolycoat.com";

document.addEventListener('DOMContentLoaded', () => {
  const header = document.querySelector('.site-header');
  const menuButton = document.querySelector('.menu-toggle');
  const mobileMenu = document.querySelector('.mobile-menu');
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

  const updateHeader = () => {
    if (header) header.classList.toggle('scrolled', window.scrollY > 24);
  };
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  menuButton?.addEventListener('click', () => {
    const open = !mobileMenu.classList.contains('open');
    mobileMenu.classList.toggle('open', open);
    document.body.classList.toggle('menu-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
  });

  mobileMenu?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    mobileMenu.classList.remove('open');
    document.body.classList.remove('menu-open');
    menuButton?.setAttribute('aria-expanded', 'false');
  }));

  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

  let activeFilter = 'all';
  const bindFilterButtons = () => {
    document.querySelectorAll('.filter-btn').forEach(button => button.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      activeFilter = button.dataset.filter;
      applyProductFilter();
    }));
  };
  const applyProductFilter = () => {
    document.querySelectorAll('.catalog-card').forEach(card => card.classList.toggle('hidden', activeFilter !== 'all' && card.dataset.category !== activeFilter));
  };
  bindFilterButtons();

  const renderFilters = categories => {
    const bar = document.querySelector('.filter-bar');
    if (!bar || !Array.isArray(categories) || categories.length === 0) return;
    bar.innerHTML = '<button class="filter-btn active" data-filter="all">All materials</button>' + categories.map(category => `<button class="filter-btn" data-filter="${escapeHtml(category.slug)}">${escapeHtml(category.name)}</button>`).join('');
    activeFilter = 'all';
    bindFilterButtons();
  };

  const renderCatalogue = products => {
    const grid = document.getElementById('catalogGrid');
    if (!grid || !Array.isArray(products)) return;
    grid.replaceChildren(...products.map(product => {
      const card = document.createElement('article');
      card.className = 'catalog-card';
      card.dataset.category = product.category;
      const swatch = document.createElement('div');
      swatch.className = 'material-swatch';
      swatch.style.setProperty('--swatch', product.swatch);
      if (product.image_path) {
        swatch.style.backgroundImage = `url("${product.image_path}")`;
        swatch.classList.add('has-image');
      }
      const info = document.createElement('div');
      info.className = 'catalog-info';
      const meta = document.createElement('div');
      meta.className = 'catalog-meta';
      const category = document.createElement('span');
      category.textContent = product.category.charAt(0).toUpperCase() + product.category.slice(1);
      const code = document.createElement('span');
      code.textContent = product.code;
      meta.append(category, code);
      const title = document.createElement('h3');
      title.textContent = product.name;
      const description = document.createElement('p');
      description.textContent = product.description;
      const properties = document.createElement('div');
      properties.className = 'properties';
      (product.properties || []).forEach(value => {
        const property = document.createElement('span');
        property.textContent = value;
        properties.append(property);
      });
      info.append(meta, title, description, properties);
      card.append(swatch, info);
      return card;
    }));
    applyProductFilter();
  };

  const loadPublicContent = async () => {
    try {
      const site = await getSite();
      document.querySelectorAll('[data-site-field]').forEach(element => {
        const value = site[element.dataset.siteField] || '';
        if (value) element.textContent = value;
        if (element.dataset.siteField === 'email') element.href = `mailto:${value}`;
        if (element.dataset.siteField === 'phone') element.href = `tel:${value.replace(/[^+\d]/g, '')}`;
      });
      document.querySelectorAll('[data-site-wrapper]').forEach(element => {
        element.hidden = !site[element.dataset.siteWrapper];
      });
      const grid = document.getElementById('catalogGrid');
      if (grid) {
        const [categories, products] = await Promise.all([getCategories(), getProducts()]);
        renderFilters(categories);
        renderCatalogue(products.length ? products : defaultProducts);
      }
    } catch (_) {
      // Keep the static fallback content when the backend is unavailable.
    }
  };
  loadPublicContent();

  document.querySelectorAll('[data-enquiry-form]').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const toast = document.querySelector('.toast');
      const button = form.querySelector('button[type="submit"]');
      const originalButtonText = button?.textContent;

      if (button) {
        button.disabled = true;
        button.textContent = 'Sending…';
      }

      try {
        const response = await fetch(ENQUIRY_ENDPOINT, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: new URLSearchParams({
            ...Object.fromEntries(new FormData(form)),
            _subject: 'New enquiry from Apex Polycoat website',
            _template: 'table',
            _captcha: 'false'
          })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success === false) throw new Error('Unable to send enquiry.');

        if (toast) {
          toast.classList.remove('error');
          toast.textContent = 'Thank you — your enquiry has been sent. Our team will get back to you soon.';
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 4500);
        }
        form.reset();
      } catch (_) {
        if (toast) {
          toast.classList.add('error', 'show');
          toast.textContent = 'We could not send your enquiry. Please email contact@apexpolycoat.com directly.';
          setTimeout(() => toast.classList.remove('error', 'show'), 5500);
        }
        // Keep a native POST fallback when a browser blocks the AJAX request.
        window.setTimeout(() => HTMLFormElement.prototype.submit.call(form), 250);
        return;
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = originalButtonText;
        }
      }
    });
  });

  const year = document.querySelector('[data-year]');
  if (year) year.textContent = new Date().getFullYear();
});
