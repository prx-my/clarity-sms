import test from 'node:test';
import assert from 'node:assert/strict';
import { originAllowed } from '../src/lib/ai/http';
test('origin checks accept Next localhost canonicalization and reject cross-site mutations',()=>{assert.equal(originAllowed(new Request('http://localhost:3100/api/ai/agents',{headers:{Origin:'http://127.0.0.1:3100',Host:'127.0.0.1:3100'}})),true);assert.equal(originAllowed(new Request('https://app.example.com/api/ai/agents',{headers:{Origin:'https://evil.example.com',Host:'app.example.com'}})),false);assert.equal(originAllowed(new Request('https://app.example.com/api/ai/agents',{headers:{Origin:'https://app.example.com',Host:'app.example.com'}})),true);});
