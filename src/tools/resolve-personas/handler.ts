/**
 * Handler for resolve_personas tool.
 * Loads personas from IndexedDB and injects their photos into context.uploadedFiles.
 */

import type { ToolExecutionContext, ToolCallbacks } from '../types';
import { getPersonasByNames } from '@/utils/userDataDB';

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  const names = args.names as string[];
  const namesList = Array.isArray(names) ? names : (typeof names === 'string' ? [names] : []);

  if (!namesList || namesList.length === 0) {
    return JSON.stringify({
      error: 'no_names',
      message: 'Please specify which people to include by name.',
    });
  }

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'resolve_personas',
    totalCount: 1,
    stepLabel: 'Loading personas...',
  });

  try {
    const personas = await getPersonasByNames(namesList);

    if (personas.length === 0) {
      callbacks.onToolComplete('resolve_personas', []);
      return JSON.stringify({
        error: 'not_found',
        message: `No personas found matching: ${namesList.join(', ')}. The user can add people in the "My People" section of the sidebar.`,
      });
    }

    // Inject persona photos into context.uploadedFiles
    const personaMap: Record<number, { name: string; description: string; relationship: string }> = {};
    let injectedCount = 0;

    for (const persona of personas) {
      // Prefer the cropped reference photo (head-to-waist) over the full original
      const photoToUse = persona.referencePhotoData || persona.photoData;
      if (photoToUse) {
        const contextImageIndex = context.uploadedFiles.length;
        context.uploadedFiles.push({
          type: 'image',
          data: photoToUse,
          width: persona.referencePhotoData ? undefined : (persona.photoWidth || undefined),
          height: persona.referencePhotoData ? undefined : (persona.photoHeight || undefined),
          mimeType: persona.photoMimeType || 'image/jpeg',
          filename: `persona-${persona.name.toLowerCase().replace(/\s+/g, '-')}.jpg`,
        });
        personaMap[contextImageIndex] = {
          name: persona.name,
          description: persona.visionDescription || persona.description || `Photo of ${persona.name}`,
          relationship: persona.relationship,
        };
        injectedCount++;
      }
    }

    // Build guidance for the LLM
    const loadedNames = personas.map(p => p.name);

    callbacks.onToolProgress({
      type: 'completed',
      toolName: 'resolve_personas',
      progress: 1,
      referencedPersonas: loadedNames,
    });

    callbacks.onToolComplete('resolve_personas', []);
    const descriptions = personas.map(p => {
      const desc = p.visionDescription || p.description || '';
      const attire = p.defaultAttire ? ` Usual attire: ${p.defaultAttire}.` : '';
      const voice = p.voice ? ` Voice: ${p.voice}.` : '';
      return `${p.name} (${p.relationship}): ${desc}${attire}${voice}`;
    }).join('\n');

    return JSON.stringify({
      success: true,
      loadedPersonas: loadedNames,
      photosInjected: injectedCount,
      contextImageMapping: personaMap,
      descriptions,
      promptGuidance: injectedCount > 0
        ? `Reference photos and appearance descriptions for ${loadedNames.join(', ')} are loaded. CRITICAL: The text descriptions below are your primary tool for capturing their likeness — incorporate these descriptors directly into your image prompt (e.g. "${personas[0]?.name || 'person'}, ${personas[0]?.visionDescription?.split(',').slice(0, 3).join(',') || 'their appearance'}"). The reference photos provide visual guidance for composition and style but will not perfectly reproduce exact facial features. Use edit_image with the context images and a detailed prompt that includes the appearance descriptors.\n\nAppearance descriptions:\n${descriptions}`
        : `Found personas ${loadedNames.join(', ')} but they have no photos uploaded. Use their appearance descriptions directly in your image prompt:\n${descriptions}`,
    });
  } catch (err: unknown) {
    console.error('[RESOLVE PERSONAS] Failed:', err);
    callbacks.onToolComplete('resolve_personas', []);
    return JSON.stringify({
      error: 'resolve_failed',
      message: `Failed to load personas: ${(err as Error).message || 'Unknown error'}`,
    });
  }
}
