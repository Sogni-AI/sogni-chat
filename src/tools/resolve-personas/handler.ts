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

    // Build per-persona descriptions with picture number references
    const personaDetails: string[] = [];
    const pictureMapping: string[] = [];
    let pictureNum = 1;
    for (const persona of personas) {
      const desc = persona.visionDescription || persona.description || '';
      const attire = persona.defaultAttire ? ` Default attire: ${persona.defaultAttire}.` : '';
      const voice = persona.voice ? ` Voice: ${persona.voice}.` : '';
      const hasPhoto = !!(persona.referencePhotoData || persona.photoData);
      if (hasPhoto) {
        pictureMapping.push(`Picture ${pictureNum} = ${persona.name}`);
        personaDetails.push(`${persona.name} (${persona.relationship}, picture ${pictureNum}): ${desc}${attire}${voice}`);
        pictureNum++;
      } else {
        personaDetails.push(`${persona.name} (${persona.relationship}, no photo): ${desc}${attire}${voice}`);
      }
    }

    const descriptions = personaDetails.join('\n');
    const mappingStr = pictureMapping.join(', ');

    // Build prompt guidance following Qwen Image Edit multi-image reference patterns
    let promptGuidance: string;
    if (injectedCount > 0) {
      promptGuidance = `Reference photos loaded as context images: ${mappingStr}.

IMPORTANT — How to use these for identity-preserving generation with edit_image:
1. Reference each person by their picture number in your prompt: "the person in picture 1", "the subject of picture 2"
2. Be EXPLICIT about preserving identity: "maintaining the person's face, ethnicity, age, hairstyle, and features from picture N"
3. Describe the new scene/pose/setting separately from the identity reference
4. Include appearance descriptors from below to reinforce the likeness

Example prompt structure for two people:
"Generate a scene of [description]. The man is the person from picture 1 — preserve his face, ethnicity, hairstyle, and features exactly. The woman is the person from picture 2 — preserve her face, ethnicity, hairstyle, and features exactly. [scene details]"

Persona details:
${descriptions}`;
    } else {
      promptGuidance = `Found personas ${loadedNames.join(', ')} but they have no photos uploaded. Use their appearance descriptions directly in your image prompt:\n${descriptions}`;
    }

    return JSON.stringify({
      success: true,
      loadedPersonas: loadedNames,
      photosInjected: injectedCount,
      contextImageMapping: personaMap,
      pictureMapping: mappingStr,
      descriptions,
      promptGuidance,
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
