import supertest from 'supertest'
import { createApp } from '../../src/app.js'

// Fresh app per worker — createApp() is a cheap factory, not a singleton.
export const app = supertest(createApp())
