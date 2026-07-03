const modules = new Map();

export function registerMfe(name, mount) {
  modules.set(name, mount);
}

export function mountMfe(name, element, context) {
  const mount = modules.get(name);
  if (!mount) throw new Error(`MFE not registered: ${name}`);
  return mount(element, context);
}

export function createEventBus() {
  const target = new EventTarget();
  return {
    emit(type, detail) {
      target.dispatchEvent(new CustomEvent(type, { detail }));
    },
    on(type, listener) {
      const wrapped = (event) => listener(event.detail);
      target.addEventListener(type, wrapped);
      return () => target.removeEventListener(type, wrapped);
    }
  };
}
