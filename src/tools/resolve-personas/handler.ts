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
        message: `No personas found matching: ${namesList.join(', ')}. The user can add people in the "My Personas" section of the sidebar.`,
      });
    }

    // Build a clean uploadedFiles array: keep user files, remove old persona
    // photos, then append fresh persona photos. We replace the array on
    // context rather than mutating in-place to avoid corrupting React state.
    const userFiles = context.uploadedFiles.filter(f => !f.filename?.startsWith('persona-'));
    const preExistingImageCount = userFiles.filter(f => f.type === 'image').length;

    const personaMap: Record<number, { name: string; description: string; relationship: string }> = {};
    let injectedCount = 0;

    for (const persona of personas) {
      const photoToUse = persona.referencePhotoData || persona.photoData;
      if (photoToUse) {
        const contextImageIndex = userFiles.length; // index before push
        userFiles.push({
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

    // Replace the context array (new array, not mutating the original React state)
    context.uploadedFiles = userFiles;

    // Build guidance for the LLM
    const loadedNames = personas.map(p => p.name);

    callbacks.onToolProgress({
      type: 'completed',
      toolName: 'resolve_personas',
      progress: 1,
      referencedPersonas: loadedNames,
    });

    callbacks.onToolComplete('resolve_personas', []);

    // Build per-persona descriptions with picture number references.
    // Picture numbers must account for pre-existing user uploads since
    // edit_image's gatherContextImages puts them first in the context array.
    const personaDetails: string[] = [];
    const pictureMapping: string[] = [];
    let pictureNum = preExistingImageCount + 1; // offset past user-uploaded images
    for (const persona of personas) {
      const desc = persona.visionDescription || persona.description || '';
      const attire = persona.defaultAttire ? ` Default attire: ${persona.defaultAttire}.` : '';
      const voice = persona.voice ? ` Voice: ${persona.voice}.` : '';
      const nicknames = persona.tags?.length ? ` Also known as: ${persona.tags.join(', ')}.` : '';
      const hasPhoto = !!(persona.referencePhotoData || persona.photoData);
      if (hasPhoto) {
        pictureMapping.push(`Picture ${pictureNum} = ${persona.name}`);
        personaDetails.push(`${persona.name} (${persona.relationship}, picture ${pictureNum}): ${desc}${attire}${voice}${nicknames}`);
        pictureNum++;
      } else {
        personaDetails.push(`${persona.name} (${persona.relationship}, no photo): ${desc}${attire}${voice}${nicknames}`);
      }
    }

    const descriptions = personaDetails.join('\n');
    const mappingStr = pictureMapping.join(', ');

    // Build prompt guidance following Qwen Image Edit multi-image reference patterns
    let promptGuidance: string;
    if (injectedCount > 0) {
      const preExistingNote = preExistingImageCount > 0
        ? `\nNote: The user's uploaded image(s) are pictures 1${preExistingImageCount > 1 ? `-${preExistingImageCount}` : ''}. Persona reference photos start at picture ${preExistingImageCount + 1}.`
        : '';

      promptGuidance = `Reference photos loaded as context images: ${mappingStr}.${preExistingNote}

IMPORTANT — Identity-preserving generation with edit_image:
1. Reference each person by picture number AND name: "${personas[0]?.name || 'Name'} is the person in picture ${preExistingImageCount + 1}"
2. Be EXPLICIT about preserving identity: "preserve ${personas[0]?.name || 'Name'}'s face, ethnicity, age, skin tone, hairstyle, and features exactly as shown in picture N"
3. NEVER use "you", "your", "I", or "me" in the prompt — always use the person's NAME. The image model doesn't know who "you" is.
4. DO NOT copy appearance descriptions into the prompt — the model can already see the reference photos. The picture number + "preserve face/features exactly" is enough.
5. Focus the prompt on the SCENE: what they're doing, wearing, where they are. Keep it natural and concise.
6. Qwen Image Edit supports max 3 context images total (including any user uploads)

Example prompt for the current context:
"${personas.filter(p => p.referencePhotoData || p.photoData).map((p, i) => `${p.name} is the person in picture ${preExistingImageCount + 1 + i} — preserve ${p.name}'s face and features exactly`).join('. ')}. [describe the scene, clothing, action, mood — not their physical appearance]."

Persona details (for your reference, NOT for pasting into prompts):
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
