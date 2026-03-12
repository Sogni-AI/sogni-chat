import { createContext, useContext } from 'react';

export interface ModalText {
  heading: string;
  subHeading: string;
}

export const defaultModalText: ModalText = {
  heading: 'Welcome to Sogni',
  subHeading: 'Sign in to get started'
};

interface ModalContextValue {
  text: ModalText;
}

const ModalContext = createContext<ModalContextValue>({ text: defaultModalText });

export function useModalCtx() {
  return useContext(ModalContext);
}

export const ModalContextProvider = ModalContext.Provider;
