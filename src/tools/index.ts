/**
 * Tool system entry point.
 *
 * Import this module to get access to the tool registry (with all registered tools)
 * and the core types. Tool modules self-register when imported — their import
 * statements below trigger registration on first load.
 */

// Phase 2b: Original 5 tools from the superapp
import './restore-photo';
import './apply-style';
import './refine-result';
import './animate-photo';
import './change-angle';

// Phase 4: New tools — 6 additional tools based on SDK examples
import './generate-image';
import './edit-image';
import './generate-video';
import './sound-to-video';
import './video-to-video';
import './generate-music';

// Phase 5: Vision analysis tool
import './analyze-image';

export { toolRegistry } from './registry';
export type {
  ToolHandler,
  ToolExecutionContext,
  ToolCallbacks,
  ToolExecutionProgress,
  ToolName,
  ToolSuggestion,
  UploadedFile,
} from './types';
