import {
  changeAdminPassword,
  deleteCategory,
  deleteProduct,
  ensureDefaultContent,
  getCategories,
  getProducts,
  getSite,
  loginAdmin,
  logoutAdmin,
  onAdminStateChanged,
  saveCategory,
  saveProduct,
  saveSite,
  uploadProductImage
} from "./firebase-service.js";

document.addEventListener("DOMContentLoaded", () => {
  const authShell = document.getElementById("authShell");
  const adminApp = document.getElementById("adminApp");
  const authForm = document.getElementById("authForm");
  const authEmail = document.getElementById("authEmail");
  const authPassword = document.getElementById("authPassword");
  const authError = document.getElementById("authError");
  const productDialog = document.getElementById("productDialog");
  const categoryDialog = document.getElementById("categoryDialog");
  const productImage = document.getElementById("productImage");
  const imagePreview = document.getElementById("imagePreview");
  const propertyInput = document.getElementById("propertyInput");
  const propertyTags = document.getElementById("propertyTags");
  const productProperties = document.getElementById("productProperties");
  let products = [];
  let categories = [];
  let propertyValues = [];

  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const titleCase = value => categories.find(category => category.slug === value)?.name || (value ? value.charAt(0).toUpperCase() + value.slice(1) : "");

  const toast = message => {
    const element = document.getElementById("adminToast");
    element.textContent = message;
    element.classList.add("show");
    window.clearTimeout(element.toastTimer);
    element.toastTimer = window.setTimeout(() => element.classList.remove("show"), 3200);
  };

  const showAuth = () => {
    adminApp.classList.add("is-hidden");
    authShell.classList.remove("is-hidden");
  };

  const showApp = async () => {
    authShell.classList.add("is-hidden");
    adminApp.classList.remove("is-hidden");
    await ensureDefaultContent();
    await Promise.all([loadCategories(), loadProducts(), loadSite()]);
  };

  onAdminStateChanged(user => {
    if (user) showApp().catch(error => toast(error.message));
    else showAuth();
  });

  authForm.addEventListener("submit", async event => {
    event.preventDefault();
    authError.textContent = "";
    try {
      await loginAdmin(authEmail.value.trim(), authPassword.value);
      authForm.reset();
    } catch (error) {
      authError.textContent = error.message;
    }
  });

  const loadCategories = async () => {
    categories = await getCategories();
    renderCategories();
    renderCategoryOptions();
  };

  const renderCategoryOptions = () => {
    const select = document.getElementById("productCategory");
    select.innerHTML = categories.map(category => `<option value="${escapeHtml(category.slug)}">${escapeHtml(category.name)}</option>`).join("");
  };

  const renderCategories = () => {
    const rows = document.getElementById("categoryRows");
    document.getElementById("categoryEmpty").classList.toggle("is-hidden", categories.length > 0);
    rows.innerHTML = categories.map(category => `
      <tr>
        <td><strong>${escapeHtml(category.name)}</strong></td>
        <td>${escapeHtml(category.slug)}</td>
        <td>${Number(category.sort_order) || 0}</td>
        <td><div class="table-actions"><button data-edit-category="${escapeHtml(category.id)}">Edit</button><button class="danger" data-delete-category="${escapeHtml(category.id)}">Delete</button></div></td>
      </tr>`).join("");
  };

  const loadProducts = async () => {
    products = await getProducts();
    renderProducts();
  };

  const renderProducts = () => {
    const rows = document.getElementById("productRows");
    document.getElementById("productEmpty").classList.toggle("is-hidden", products.length > 0);
    rows.innerHTML = products.map(product => `
      <tr>
        <td><div class="admin-material">${product.image_path ? `<img class="admin-thumb" src="${escapeHtml(product.image_path)}" alt="">` : `<span class="admin-swatch" style="background:${escapeHtml(product.swatch)}"></span>`}<div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.description.slice(0, 55))}${product.description.length > 55 ? "..." : ""}</small></div></div></td>
        <td>${escapeHtml(titleCase(product.category))}</td><td>${escapeHtml(product.code)}</td><td>${Number(product.sort_order) || 0}</td>
        <td><div class="table-actions"><button data-edit-product="${escapeHtml(product.id)}">Edit</button><button class="danger" data-delete-product="${escapeHtml(product.id)}">Delete</button></div></td>
      </tr>`).join("");
  };

  const syncProperties = () => {
    productProperties.value = propertyValues.join(", ");
    propertyTags.innerHTML = propertyValues.map((value, index) => `<button type="button" data-remove-property="${index}">${escapeHtml(value)} <span>x</span></button>`).join("");
  };

  const openProduct = product => {
    document.getElementById("dialogTitle").textContent = product ? "Edit product" : "Add product";
    document.getElementById("productId").value = product?.id || "";
    document.getElementById("productName").value = product?.name || "";
    document.getElementById("productCode").value = product?.code || "";
    document.getElementById("productCategory").value = product?.category || categories[0]?.slug || "";
    document.getElementById("productSwatch").value = product?.swatch || "#a64128";
    document.getElementById("productSwatchText").value = product?.swatch || "#a64128";
    document.getElementById("productDescription").value = product?.description || "";
    document.getElementById("productOrder").value = product?.sort_order ?? products.length;
    document.getElementById("productImagePath").value = product?.image_path || "";
    productImage.value = "";
    propertyInput.value = "";
    propertyValues = [...(product?.properties || [])];
    imagePreview.innerHTML = product?.image_path ? `<img src="${escapeHtml(product.image_path)}" alt="">` : "<span>No image selected</span>";
    document.getElementById("productError").textContent = "";
    syncProperties();
    productDialog.showModal();
  };

  const openCategory = category => {
    document.getElementById("categoryDialogTitle").textContent = category ? "Edit category" : "Add category";
    document.getElementById("categoryId").value = category?.id || "";
    document.getElementById("categoryName").value = category?.name || "";
    document.getElementById("categorySlug").value = category?.slug || "";
    document.getElementById("categoryOrder").value = category?.sort_order ?? categories.length;
    document.getElementById("categoryError").textContent = "";
    categoryDialog.showModal();
  };

  document.getElementById("addProductButton").addEventListener("click", () => openProduct(null));
  document.getElementById("dialogClose").addEventListener("click", () => productDialog.close());
  document.getElementById("dialogCancel").addEventListener("click", () => productDialog.close());

  document.getElementById("addCategoryButton").addEventListener("click", () => openCategory(null));
  document.getElementById("categoryDialogClose").addEventListener("click", () => categoryDialog.close());
  document.getElementById("categoryDialogCancel").addEventListener("click", () => categoryDialog.close());

  document.getElementById("categoryRows").addEventListener("click", async event => {
    const edit = event.target.closest("[data-edit-category]");
    const remove = event.target.closest("[data-delete-category]");
    if (edit) openCategory(categories.find(category => category.id === edit.dataset.editCategory));
    if (remove) {
      const category = categories.find(item => item.id === remove.dataset.deleteCategory);
      if (!window.confirm(`Delete ${category.name}? Products in this category will keep their category value.`)) return;
      try {
        await deleteCategory(category.id);
        await loadCategories();
        toast("Category deleted.");
      } catch (error) { toast(error.message); }
    }
  });

  document.getElementById("productRows").addEventListener("click", async event => {
    const edit = event.target.closest("[data-edit-product]");
    const remove = event.target.closest("[data-delete-product]");
    if (edit) openProduct(products.find(product => product.id === edit.dataset.editProduct));
    if (remove) {
      const product = products.find(item => item.id === remove.dataset.deleteProduct);
      if (!window.confirm(`Delete ${product.name}? This removes it from the public catalogue.`)) return;
      try {
        await deleteProduct(product.id);
        await loadProducts();
        toast("Product deleted.");
      } catch (error) { toast(error.message); }
    }
  });

  const swatch = document.getElementById("productSwatch");
  const swatchText = document.getElementById("productSwatchText");
  swatch.addEventListener("input", () => { swatchText.value = swatch.value; });
  swatchText.addEventListener("input", () => { if (/^#[0-9a-f]{6}$/i.test(swatchText.value)) swatch.value = swatchText.value; });

  document.getElementById("uploadImageButton").addEventListener("click", () => productImage.click());
  productImage.addEventListener("change", () => {
    const file = productImage.files?.[0];
    imagePreview.innerHTML = file ? `<img src="${escapeHtml(URL.createObjectURL(file))}" alt="">` : "<span>No image selected</span>";
  });

  propertyInput.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const value = propertyInput.value.trim();
    if (value && !propertyValues.includes(value) && propertyValues.length < 8) propertyValues.push(value);
    propertyInput.value = "";
    syncProperties();
  });

  propertyTags.addEventListener("click", event => {
    const button = event.target.closest("[data-remove-property]");
    if (!button) return;
    propertyValues.splice(Number(button.dataset.removeProperty), 1);
    syncProperties();
  });

  document.getElementById("productForm").addEventListener("submit", async event => {
    event.preventDefault();
    const id = document.getElementById("productId").value;
    const errorElement = document.getElementById("productError");
    errorElement.textContent = "";
    try {
      let imagePath = document.getElementById("productImagePath").value;
      if (productImage.files?.[0]) {
        imagePath = await uploadProductImage(productImage.files[0]);
      }
      await saveProduct(id, {
        name: document.getElementById("productName").value,
        code: document.getElementById("productCode").value,
        category: document.getElementById("productCategory").value,
        swatch: swatchText.value,
        image_path: imagePath,
        description: document.getElementById("productDescription").value,
        properties: propertyValues,
        sort_order: document.getElementById("productOrder").value
      });
      productDialog.close();
      await loadProducts();
      toast(id ? "Product updated." : "Product added to the catalogue.");
    } catch (error) { errorElement.textContent = error.message; }
  });

  document.getElementById("categoryForm").addEventListener("submit", async event => {
    event.preventDefault();
    const errorElement = document.getElementById("categoryError");
    errorElement.textContent = "";
    try {
      await saveCategory({
        id: document.getElementById("categoryId").value,
        name: document.getElementById("categoryName").value,
        slug: document.getElementById("categorySlug").value,
        sort_order: document.getElementById("categoryOrder").value
      });
      categoryDialog.close();
      await loadCategories();
      toast("Category saved.");
    } catch (error) { errorElement.textContent = error.message; }
  });

  const loadSite = async () => {
    const site = await getSite();
    Object.entries(site).forEach(([key, value]) => {
      const field = document.querySelector(`#siteForm [name="${key}"]`);
      if (field) field.value = value;
    });
  };

  document.getElementById("siteForm").addEventListener("submit", async event => {
    event.preventDefault();
    const errorElement = document.getElementById("siteError");
    errorElement.textContent = "";
    try {
      await saveSite(Object.fromEntries(new FormData(event.currentTarget)));
      toast("Company details saved.");
    } catch (error) { errorElement.textContent = error.message; }
  });

  document.getElementById("passwordForm").addEventListener("submit", async event => {
    event.preventDefault();
    const errorElement = document.getElementById("passwordError");
    errorElement.textContent = "";
    const current = document.getElementById("currentPassword").value;
    const next = document.getElementById("newPassword").value;
    if (next !== document.getElementById("confirmPassword").value) {
      errorElement.textContent = "New passwords do not match.";
      return;
    }
    try {
      await changeAdminPassword(current, next);
      event.currentTarget.reset();
      toast("Password updated.");
    } catch (error) { errorElement.textContent = error.message; }
  });

  document.querySelectorAll("[data-admin-tab]").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll("[data-admin-tab]").forEach(item => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-admin-panel]").forEach(panel => panel.classList.toggle("is-hidden", panel.dataset.adminPanel !== button.dataset.adminTab));
    document.getElementById("sectionTitle").textContent = button.textContent.replace(/^\d+/, "").trim();
  }));

  document.querySelectorAll("[data-logout]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await logoutAdmin();
      button.disabled = false;
    } catch (error) {
      button.disabled = false;
      toast(error.message);
    }
  }));
});
