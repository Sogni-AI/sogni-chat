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

      // Inject voice clip as audio file for LTX-2.3 referenceAudioIdentity
      if (persona.voiceClipData && persona.voiceClipMimeType) {
        userFiles.push({
          type: 'audio',
          data: persona.voiceClipData,
          mimeType: persona.voiceClipMimeType,
          filename: `persona-voiceclip-${persona.name.toLowerCase().replace(/\s+/g, '-')}`,
          duration: persona.voiceClipDuration || undefined,
        });
        console.log(`[RESOLVE PERSONAS] Injected voice clip for ${persona.name} (${(persona.voiceClipData.length / 1024).toFixed(1)}KB)`);
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

IMPORTANT — Creative generation with edit_image using persona references:
1. Anchor each person's face with their picture number: "use the face from picture ${preExistingImageCount + 1} for ${personas[0]?.name || 'Name'}"
2. LEAD with the creative transformation — what to create, the scene, the style, the mood. This is the MAIN instruction.
3. Keep identity anchors brief — the model already sees the reference photos. Just the picture number is enough to bind the face.
4. NEVER use "you", "your", "I", or "me" in the prompt — always use the person's NAME.
5. Do NOT say "preserve exactly" or list physical features — this causes the model to reproduce the photo unchanged. Instead, let the picture reference handle identity naturally.
6. Qwen Image Edit supports max 3 context images total (including any user uploads)

Example prompt for the current context:
"${personas.filter(p => p.referencePhotoData || p.photoData).map((p, i) => `Use the face from picture ${preExistingImageCount + 1 + i} for ${p.name}`).join('. ')}. [MAIN CREATIVE DIRECTION: describe the scene, style, transformation, action, mood — be vivid and specific]."

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
