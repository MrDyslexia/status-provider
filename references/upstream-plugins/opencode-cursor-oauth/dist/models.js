export async function getCursorModels(apiKey) {
    if (cachedModels)
        return cachedModels;
    const discovered = await fetchCursorUsableModels(apiKey);
    if (discovered && discovered.length > 0) {
        cachedModels = discovered;
        return cachedModels;
    }
    return FALLBACK_MODELS;
}

const FALLBACK_MODELS = [];
