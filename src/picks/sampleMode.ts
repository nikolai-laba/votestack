import { createContext, useContext } from 'react'

/**
 * True while the ballot (HomePage) shows a sample (src/ballot/samples.ts): the
 * ballot list and race panel then show no pick controls, so nothing about a
 * sample is ever written to the device store.
 */
export const SampleModeContext = createContext(false)

export const useSampleMode = () => useContext(SampleModeContext)
