import type { WorkerRegistration } from '../application';
import { createDirectoryProvisioner } from './src/provisioner.ts';

export const registration = {
  workspaceProvisioner: {
    mount(context) {
      return createDirectoryProvisioner(context);
    },
  },
} satisfies WorkerRegistration;
