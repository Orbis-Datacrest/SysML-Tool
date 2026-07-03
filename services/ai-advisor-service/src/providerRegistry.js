export class AiProviderRegistry {
  providers = new Map();

  register(providerName, provider) {
    this.providers.set(providerName, provider);
  }

  async preview(providerName, request) {
    const provider = this.providers.get(providerName);
    if (!provider) throw new Error(`AI provider is not registered: ${providerName}`);
    return provider.previewDiagramPatch(request);
  }
}

export const localProvider = {
  async previewDiagramPatch(request) {
    return {
      summary: `Local provider planned an update for ${request.diagram_id}`,
      operations: []
    };
  }
};
