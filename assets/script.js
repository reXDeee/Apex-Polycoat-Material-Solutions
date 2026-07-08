document.addEventListener('DOMContentLoaded', () => {
  const header = document.querySelector('.site-header');
  const menuButton = document.querySelector('.menu-toggle');
  const mobileMenu = document.querySelector('.mobile-menu');

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

  const filterButtons = document.querySelectorAll('.filter-btn');
  let activeFilter = 'all';
  const applyProductFilter = () => {
    document.querySelectorAll('.catalog-card').forEach(card => card.classList.toggle('hidden', activeFilter !== 'all' && card.dataset.category !== activeFilter));
  };
  filterButtons.forEach(button => button.addEventListener('click', () => {
    filterButtons.forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    activeFilter = button.dataset.filter;
    applyProductFilter();
  }));

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
      const siteResponse = await fetch('/api/site');
      if (siteResponse.ok) {
        const { site } = await siteResponse.json();
        document.querySelectorAll('[data-site-field]').forEach(element => {
          const value = site[element.dataset.siteField] || '';
          if (value) element.textContent = value;
          if (element.dataset.siteField === 'email') element.href = `mailto:${value}`;
          if (element.dataset.siteField === 'phone') element.href = `tel:${value.replace(/[^+\d]/g, '')}`;
        });
        document.querySelectorAll('[data-site-wrapper]').forEach(element => {
          element.hidden = !site[element.dataset.siteWrapper];
        });
      }
      const grid = document.getElementById('catalogGrid');
      if (grid) {
        const productResponse = await fetch('/api/products');
        if (productResponse.ok) renderCatalogue((await productResponse.json()).products);
      }
    } catch (_) {
      // Keep the static fallback content when the backend is unavailable.
    }
  };
  loadPublicContent();

  document.querySelectorAll('[data-enquiry-form]').forEach(form => {
    form.addEventListener('submit', event => {
      event.preventDefault();
      const toast = document.querySelector('.toast');
      if (toast) {
        toast.textContent = 'Thank you — your enquiry has been recorded. Our team will get back to you soon.';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 4500);
      }
      form.reset();
    });
  });

  const year = document.querySelector('[data-year]');
  if (year) year.textContent = new Date().getFullYear();
});
