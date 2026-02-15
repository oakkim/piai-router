export function composeMiddleware(middlewares, terminal) {
  const list = Array.isArray(middlewares) ? middlewares : [];

  return async function run(context) {
    let index = -1;

    const dispatch = async (i) => {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      const fn = i < list.length ? list[i] : terminal;
      if (typeof fn !== "function") {
        return;
      }
      await fn(context, () => dispatch(i + 1));
    };

    await dispatch(0);
  };
}
