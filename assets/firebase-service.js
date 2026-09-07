import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  EmailAuthProvider,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  getDoc,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

const defaultCategories = [
  { id: "automotive", name: "Automotive", slug: "automotive", sort_order: 0 },
  { id: "furnishing", name: "Furnishing", slug: "furnishing", sort_order: 1 },
  { id: "footwear", name: "Footwear", slug: "footwear", sort_order: 2 },
  { id: "lifestyle", name: "Lifestyle", slug: "lifestyle", sort_order: 3 }
];

export const defaultProducts = [
  { name: "Veloce Grain", code: "APX 101", category: "automotive", swatch: "#823d28", description: "Balanced softness and surface resilience for seating and trim.", properties: ["Low gloss", "Fine grain", "Durable"], sort_order: 0 },
  { name: "Atelier Pebble", code: "APX 204", category: "furnishing", swatch: "#384537", description: "Rich pebble character with a warm, supple handle.", properties: ["Soft touch", "Pebble", "Easy care"], sort_order: 1 },
  { name: "Stride Flex", code: "APX 307", category: "footwear", swatch: "#c2a376", description: "Flexible, clean-finishing surface developed for daily movement.", properties: ["Flexible", "Matte", "Consistent"], sort_order: 2 },
  { name: "Studio Nappa", code: "APX 412", category: "lifestyle", swatch: "#293b48", description: "A smooth contemporary finish for bags and small leather goods.", properties: ["Smooth", "Supple", "Versatile"], sort_order: 3 },
  { name: "Contract Weave", code: "APX 218", category: "furnishing", swatch: "#d1c6ad", description: "A textile-inspired grain for hospitality and high-use interiors.", properties: ["Textile grain", "Contract", "Cleanable"], sort_order: 4 },
  { name: "Carbon Micro", code: "APX 126", category: "automotive", swatch: "#262626", description: "Technical micro-texture with a controlled, modern sheen.", properties: ["Micro grain", "Technical", "Low sheen"], sort_order: 5 },
  { name: "Form Classic", code: "APX 329", category: "footwear", swatch: "#752d32", description: "Timeless grain and rich colour for structured footwear uppers.", properties: ["Structured", "Rich colour", "Embossable"], sort_order: 6 },
  { name: "Craft Suede", code: "APX 436", category: "lifestyle", swatch: "#aa7542", description: "A soft, directional surface with understated visual depth.", properties: ["Soft nap", "Warm touch", "Crafted"], sort_order: 7 },
  { name: "Terra Matte", code: "APX 241", category: "furnishing", swatch: "#6d7067", description: "Quiet, mineral-inspired colour and an architectural matte finish.", properties: ["Ultra matte", "Modern", "Soft hand"], sort_order: 8 }
];

export const defaultSite = {
  company_name: "Apex Polycoat Solutions",
  email: "contact@apexpolycoat.com",
  phone: "",
  address: "",
  footer_description: "Performance leatherette and coated fabric solutions developed for modern products and spaces."
};

const normalizeDoc = snapshot => ({ id: snapshot.id, ...snapshot.data() });

export const onAdminStateChanged = callback => onAuthStateChanged(auth, callback);

export const loginAdmin = (email, password) => signInWithEmailAndPassword(auth, email, password);

export const logoutAdmin = () => signOut(auth);

export const changeAdminPassword = async (currentPassword, nextPassword) => {
  if (!auth.currentUser?.email) throw new Error("Sign in again before changing your password.");
  const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
  await reauthenticateWithCredential(auth.currentUser, credential);
  await updatePassword(auth.currentUser, nextPassword);
};

export const getCategories = async () => {
  const snapshot = await getDocs(query(collection(db, "categories"), orderBy("sort_order"), orderBy("name")));
  return snapshot.docs.map(normalizeDoc);
};

export const saveCategory = async category => {
  const slug = String(category.slug || category.name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!category.name || !slug) throw new Error("Name and slug are required.");
  const payload = {
    name: String(category.name).trim(),
    slug,
    sort_order: Number(category.sort_order) || 0,
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(db, "categories", slug), payload, { merge: true });
  if (category.id && category.id !== slug) await deleteDoc(doc(db, "categories", category.id));
};

export const deleteCategory = id => deleteDoc(doc(db, "categories", id));

export const getProducts = async () => {
  const snapshot = await getDocs(query(collection(db, "products"), orderBy("sort_order"), orderBy("name")));
  return snapshot.docs.map(normalizeDoc);
};

export const saveProduct = async (id, product) => {
  const payload = {
    name: String(product.name || "").trim(),
    code: String(product.code || "").trim().toUpperCase(),
    category: String(product.category || "").trim(),
    swatch: String(product.swatch || "").trim().toLowerCase(),
    image_path: String(product.image_path || "").trim(),
    description: String(product.description || "").trim(),
    properties: Array.isArray(product.properties) ? product.properties : String(product.properties || "").split(",").map(value => value.trim()).filter(Boolean),
    sort_order: Number(product.sort_order) || 0,
    updatedAt: serverTimestamp()
  };
  if (!payload.name || !payload.code || !payload.category || !payload.description) throw new Error("Complete all required product fields.");
  if (!/^#[0-9a-f]{6}$/i.test(payload.swatch)) throw new Error("Swatch must be a valid hex colour.");
  if (id) {
    await updateDoc(doc(db, "products", id), payload);
    return id;
  }
  const created = await addDoc(collection(db, "products"), { ...payload, createdAt: serverTimestamp() });
  return created.id;
};

export const deleteProduct = id => deleteDoc(doc(db, "products", id));

export const getSite = async () => {
  const snapshot = await getDoc(doc(db, "site", "settings"));
  return snapshot.exists() ? { ...defaultSite, ...snapshot.data() } : defaultSite;
};

export const saveSite = site => setDoc(doc(db, "site", "settings"), {
  company_name: String(site.company_name || "").trim(),
  email: String(site.email || "").trim(),
  phone: String(site.phone || "").trim(),
  address: String(site.address || "").trim(),
  footer_description: String(site.footer_description || "").trim(),
  updatedAt: serverTimestamp()
}, { merge: true });

export const uploadProductImage = async file => {
  if (!file) return "";
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  const extension = file.name.split(".").pop() || "jpg";
  const imageRef = ref(storage, `products/${Date.now()}-${crypto.randomUUID()}.${extension}`);
  await uploadBytes(imageRef, file, { contentType: file.type });
  return getDownloadURL(imageRef);
};

export const ensureDefaultContent = async () => {
  const [categories, products, siteSnapshot] = await Promise.all([
    getDocs(collection(db, "categories")),
    getDocs(collection(db, "products")),
    getDoc(doc(db, "site", "settings"))
  ]);
  const writes = [];
  if (categories.empty) {
    defaultCategories.forEach(category => {
      writes.push(setDoc(doc(db, "categories", category.id), {
        name: category.name,
        slug: category.slug,
        sort_order: category.sort_order,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }));
    });
  }
  if (products.empty) {
    defaultProducts.forEach(product => {
      writes.push(addDoc(collection(db, "products"), {
        ...product,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }));
    });
  }
  if (!siteSnapshot.exists()) {
    writes.push(setDoc(doc(db, "site", "settings"), {
      ...defaultSite,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
  }
  await Promise.all(writes);
};
